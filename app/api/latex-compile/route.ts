import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, normalize } from "node:path";
import { promisify } from "node:util";
import { auth } from "@clerk/nextjs/server";
import { diagnoseLatexErrors, diagnoseMissingFigures, isBinaryAssetName, looksLikeBase64, stripDataUrlPrefix, validMagicBytes } from "@/lib/latex-diagnostics";
import { createRateLimiter } from "@/lib/rate-limit";

const execFileAsync = promisify(execFile);

const ASSETS_ROOT = process.env.PROJECT_ASSETS_DIR || "/app/data/assets";
const BUILD_ROOT = process.env.PROJECT_BUILD_DIR || "/app/data/build";
// Per-project build dirs are evicted when they exceed this (in bytes).
const BUILD_DIR_MAX_BYTES = 300 * 1024 * 1024;

function sanitizeAssetPath(value: string): string {
  const parts = normalize(value)
    .replace(/\\/g, "/")
    .split("/")
    .filter((p) => p && p !== "." && p !== "..");
  return parts.join("/");
}

// Persistent per-project build dir so latexmk can reuse .aux/.fdb_latexmk and
// skip unchanged work (fast recompiles).
function buildDirPath(userId: string, projectId: string): string {
  return join(BUILD_ROOT, userId, sanitizeAssetPath(projectId));
}

async function dirSizeRecursive(dir: string): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await dirSizeRecursive(full);
    } else {
      try {
        total += (await stat(full)).size;
      } catch {
        /* ignore */
      }
    }
  }
  return total;
}

// Recursively copy a project's stored images (figures) into the compile temp
// dir so \includegraphics resolves without shipping base64 in the POST body.
// Corrupt binary files (bad magic bytes) are skipped and recorded by name so
// the user gets a clear message instead of a raw pdflatex parse failure.
async function copyAssetsRecursive(
  srcDir: string,
  destDir: string,
  corrupt: string[] = [],
  prefix = ""
): Promise<void> {
  let entries;
  try {
    entries = await readdir(srcDir, { withFileTypes: true });
  } catch {
    return; // no stored assets for this project
  }
  for (const entry of entries) {
    const src = join(srcDir, entry.name);
    const dest = join(destDir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await mkdir(dest, { recursive: true });
      await copyAssetsRecursive(src, dest, corrupt, rel);
    } else {
      if (isBinaryAssetName(rel)) {
        const bytes = await readFile(src);
        if (!validMagicBytes(rel, bytes)) {
          corrupt.push(rel);
          continue;
        }
      }
      await mkdir(dirname(dest), { recursive: true });
      await copyFile(src, dest);
    }
  }
}

async function writeProjectFile(targetPath: string, path: string, content: string): Promise<void> {
  const isEncoded =
    isBinaryAssetName(path) || (/\.(eps|svg)$/i.test(path) && looksLikeBase64(content));
  if (isEncoded) {
    await writeFile(targetPath, Buffer.from(stripDataUrlPrefix(content), "base64"));
  } else {
    await writeFile(targetPath, content, "utf8");
  }
}

// The exact bytes writeProjectFile would produce for a path/content pair.
function projectFileBytes(path: string, content: string): Buffer {
  const isEncoded =
    isBinaryAssetName(path) || (/\.(eps|svg)$/i.test(path) && looksLikeBase64(content));
  return isEncoded
    ? Buffer.from(stripDataUrlPrefix(content), "base64")
    : Buffer.from(content, "utf8");
}

async function fileBytesEqual(targetPath: string, expected: Buffer): Promise<boolean> {
  try {
    const existing = await readFile(targetPath);
    return existing.equals(expected);
  } catch {
    return false;
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 15;
const GUEST_RATE_WINDOW_MS = 60 * 60 * 1000;
const GUEST_RATE_MAX_REQUESTS = 10;
const checkRateLimit = createRateLimiter(RATE_WINDOW_MS, RATE_MAX_REQUESTS);
const checkGuestRateLimit = createRateLimiter(GUEST_RATE_WINDOW_MS, GUEST_RATE_MAX_REQUESTS);

type CompileInputFile = {
  path: string;
  content: string;
};

type CompileRequestPayload = {
  rootFile?: string;
  files?: CompileInputFile[];
  projectId?: string;
  clean?: boolean;
};

type LatexEngine = {
  name: "texliveonfly" | "tectonic" | "latexmk";
  binary: string;
  buildArgs: (rootFile: string) => string[];
};

type AutoInstallResult =
  | {
      ok: true;
      manager: "tlmgr" | "apt";
      packageName: string;
      mode?: "system" | "usermode";
    }
  | {
      ok: false;
      detail: string;
    };

const STY_TO_APT_HINTS: Record<string, string[]> = {
  siunitx: ["texlive-science"],
  ieeetran: ["texlive-publishers"],
  xstring: ["texlive-latex-extra"],
  pgfplots: ["texlive-pictures"],
  tikz: ["texlive-pictures"],
  algorithm2e: ["texlive-science"],
  minted: ["texlive-latex-extra", "python3-pygments"],
  biblatex: ["texlive-bibtex-extra", "biber"],
  csquotes: ["texlive-latex-extra"],
  xcolor: ["texlive-latex-recommended"],
  fontawesome5: ["texlive-fonts-extra"],
};

const STY_TO_TLMGR_HINTS: Record<string, string[]> = {
  siunitx: ["siunitx"],
  pgfplots: ["pgfplots"],
  tikz: ["pgf"],
  algorithm2e: ["algorithm2e"],
  minted: ["minted"],
  biblatex: ["biblatex"],
  csquotes: ["csquotes"],
  xcolor: ["xcolor"],
  fontawesome5: ["fontawesome5"],
};

const ENGINES: LatexEngine[] = [
  {
    name: "latexmk",
    binary: "latexmk",
    buildArgs: (rootFile) => ["-pdf", "-synctex=1", "-interaction=nonstopmode", "-file-line-error", rootFile],
  },
  {
    name: "texliveonfly",
    binary: "texliveonfly",
    buildArgs: (rootFile) => [
      "--compiler",
      "latexmk",
      "--arguments",
      "-pdf -synctex=1 -interaction=nonstopmode -file-line-error",
      rootFile,
    ],
  },
  {
    name: "tectonic",
    binary: "tectonic",
    buildArgs: (rootFile) => ["--keep-logs", "--outdir", ".", rootFile],
  },
];

function jsonError(message: string, status: number, mainLog?: string, mainLogFileName?: string) {
  return Response.json(
    {
      error: message,
      mainLog,
      mainLogFileName,
    },
    { status }
  );
}

function isSafeProjectPath(filePath: string) {
  if (!filePath || filePath.endsWith("/")) return false;
  if (filePath.includes("\0")) return false;
  if (filePath.startsWith("/") || filePath.startsWith("\\")) return false;

  const normalized = normalize(filePath).replaceAll("\\", "/");
  if (normalized.startsWith("../") || normalized.includes("/../") || normalized === "..") return false;

  return true;
}

function sanitizeFileName(fileName: string) {
  const base = fileName.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return base || "compiled.pdf";
}

function buildPdfOutputPath(rootFile: string) {
  const normalized = normalize(rootFile);
  const extensionIndex = normalized.lastIndexOf(".");
  if (extensionIndex === -1) return `${normalized}.pdf`;
  return `${normalized.slice(0, extensionIndex)}.pdf`;
}

function buildLogOutputPath(rootFile: string) {
  const normalized = normalize(rootFile);
  const extensionIndex = normalized.lastIndexOf(".");
  if (extensionIndex === -1) return `${normalized}.log`;
  return `${normalized.slice(0, extensionIndex)}.log`;
}

function buildSynctexPath(rootFile: string) {
  const normalized = normalize(rootFile);
  const extensionIndex = normalized.lastIndexOf(".");
  if (extensionIndex === -1) return `${normalized}.synctex.gz`;
  return `${normalized.slice(0, extensionIndex)}.synctex.gz`;
}

async function readMainLogIfAvailable(tempDir: string, rootFile: string) {
  const logFileName = buildLogOutputPath(rootFile);
  const logPath = join(tempDir, logFileName);

  try {
    const raw = await readFile(logPath, "utf8");
    const maxChars = 200_000;
    return {
      text: raw.length > maxChars ? raw.slice(raw.length - maxChars) : raw,
      fileName: sanitizeFileName(logFileName),
    };
  } catch {
    return null;
  }
}

function extractErrorDetail(error: unknown) {
  if (typeof error === "object" && error !== null) {
    const withDetails = error as { stderr?: string; stdout?: string; message?: string };
    const combined = [withDetails.stderr, withDetails.stdout, withDetails.message]
      .filter((value): value is string => Boolean(value && value.trim()))
      .join("\n")
      .trim();

    if (combined) {
      return combined.split("\n").slice(-10).join("\n");
    }
  }

  if (error instanceof Error) return error.message;
  return "unknown compile error";
}

function extractMissingStyName(detail: string) {
  const styMatch = detail.match(/File [`']([^`']+)\.sty['`] not found/i);
  if (styMatch?.[1]) return styMatch[1].toLowerCase();
  const clsMatch = detail.match(/File [`']([^`']+)\.cls['`] not found/i);
  return clsMatch?.[1]?.toLowerCase() || "";
}

function getMissingStyPackageHint(detail: string) {
  const sty = extractMissingStyName(detail);
  if (!sty) return "";
  const hints = STY_TO_APT_HINTS[sty];
  if (!hints?.length) {
    return `Missing package '${sty}.sty'. Install the TeX package that provides it, then re-run compile.`;
  }

  const installCmd = `sudo apt-get install -y ${hints.join(" ")}`;
  return `Missing package '${sty}.sty'. Install with: ${installCmd} and re-run compile.`;
}

function getTlmgrPackageCandidates(sty: string) {
  const normalized = sty.toLowerCase().replace(/[^a-z0-9_-]/g, "");
  const mapped = STY_TO_TLMGR_HINTS[normalized] ?? [];
  return Array.from(new Set([normalized, ...mapped])).filter(Boolean);
}

function getTlmgrHistoricRepository(year: string) {
  return `https://ftp.math.utah.edu/pub/tex/historic/systems/texlive/${year}/tlnet-final`;
}

function extractTeXLiveYear(text: string) {
  const match = text.match(/TeX Live\s+(\d{4})/i);
  return match?.[1] ?? "";
}

function isCrossReleaseTlmgrError(detail: string) {
  return /Local TeX Live \(\d{4}\) is older than remote repository \(\d{4}\)/i.test(detail);
}

function canUseAptGet() {
  // The runtime user no longer has passwordless sudo (it was a privilege-
  // escalation path for user-submitted code). apt-get auto-install is disabled;
  // missing .sty packages install into the user's own texmf tree via tlmgr.
  return false;
}

async function detectLocalTeXLiveYear() {
  try {
    const result = await execFileAsync("tlmgr", ["--version"], {
      timeout: 20_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const combined = `${result.stdout || ""}\n${result.stderr || ""}`;
    return extractTeXLiveYear(combined);
  } catch {
    return "";
  }
}

async function tryInstallWithTlmgrArgs(args: string[]) {
  try {
    await execFileAsync("tlmgr", args, {
      timeout: 240_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      detail: `tlmgr ${args.join(" ")}: ${extractErrorDetail(error)}`,
    };
  }
}

async function tryInstallWithTlmgr(sty: string): Promise<AutoInstallResult> {
  const candidates = getTlmgrPackageCandidates(sty);
  const failures: string[] = [];
  const localYear = await detectLocalTeXLiveYear();
  const historicRepo = localYear ? getTlmgrHistoricRepository(localYear) : "";

  for (const pkg of candidates) {
    const systemInstall = await tryInstallWithTlmgrArgs(["install", pkg]);
    if (systemInstall.ok) {
      return {
        ok: true,
        manager: "tlmgr",
        packageName: pkg,
        mode: "system",
      };
    }
    failures.push(systemInstall.detail);

    if (historicRepo && isCrossReleaseTlmgrError(systemInstall.detail)) {
      const pinnedSystemInstall = await tryInstallWithTlmgrArgs(["--repository", historicRepo, "install", pkg]);
      if (pinnedSystemInstall.ok) {
        return {
          ok: true,
          manager: "tlmgr",
          packageName: pkg,
          mode: "system",
        };
      }
      failures.push(pinnedSystemInstall.detail);
    }

    try {
      await execFileAsync("tlmgr", ["init-usertree"], {
        timeout: 60_000,
        maxBuffer: 8 * 1024 * 1024,
      }).catch(() => {
        // user tree might already be initialized
      });
    } catch (error) {
      failures.push(`tlmgr init-usertree: ${extractErrorDetail(error)}`);
    }

    const userInstall = await tryInstallWithTlmgrArgs(["--usermode", "install", pkg]);
    if (userInstall.ok) {
      return {
        ok: true,
        manager: "tlmgr",
        packageName: pkg,
        mode: "usermode",
      };
    }
    failures.push(userInstall.detail);

    if (historicRepo && isCrossReleaseTlmgrError(userInstall.detail)) {
      const pinnedUserInstall = await tryInstallWithTlmgrArgs([
        "--usermode",
        "--repository",
        historicRepo,
        "install",
        pkg,
      ]);
      if (pinnedUserInstall.ok) {
        return {
          ok: true,
          manager: "tlmgr",
          packageName: pkg,
          mode: "usermode",
        };
      }
      failures.push(pinnedUserInstall.detail);
    }
  }

  return {
    ok: false,
    detail: failures.length
      ? failures.slice(0, 6).join("\n")
      : `tlmgr could not install '${sty}' (no candidate succeeded).`,
  };
}

async function tryInstallWithApt(sty: string): Promise<AutoInstallResult> {
  if (!canUseAptGet()) {
    return {
      ok: false,
      detail: "apt-get fallback skipped: server process is not running as root.",
    };
  }

  const aptPackages = STY_TO_APT_HINTS[sty] ?? [];

  // No specific hint: install the broad TeX Live collections that cover the
  // vast majority of packages used in academic papers.
  const targets = aptPackages.length
    ? aptPackages
    : [
        "texlive-latex-extra",
        "texlive-science",
        "texlive-pictures",
        "texlive-bibtex-extra",
        "texlive-fonts-extra",
        "texlive-publishers",
      ];

  try {
    // Refresh package lists first (image clears them to stay small)
    await execFileAsync("sudo", ["apt-get", "update"], {
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, DEBIAN_FRONTEND: "noninteractive" },
    }).catch(() => {
      // non-fatal; proceed with existing lists
    });

    await execFileAsync("sudo", ["apt-get", "install", "-y", "--no-install-recommends", ...targets], {
      timeout: 420_000,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, DEBIAN_FRONTEND: "noninteractive" },
    });

    return {
      ok: true,
      manager: "apt",
      packageName: targets.join(" "),
    };
  } catch (error) {
    return {
      ok: false,
      detail: `apt-get install ${targets.join(" ")}: ${extractErrorDetail(error)}`,
    };
  }
}

async function tryAutoInstallMissingSty(sty: string): Promise<AutoInstallResult> {
  // apt-get first: Debian repos are reachable and reliable, while tlmgr's CTAN
  // mirror is often unreachable from this container. This matches how a managed
  // TeX Live (Overleaf-style) resolves packages on the fly.
  const aptResult = await tryInstallWithApt(sty);
  if (aptResult.ok) {
    return aptResult;
  }

  const tlmgrResult = await tryInstallWithTlmgr(sty);
  if (tlmgrResult.ok) {
    return tlmgrResult;
  }

  return {
    ok: false,
    detail: `${aptResult.detail}\n${tlmgrResult.detail}`,
  };
}

async function compileWithEngine(
  tempDir: string,
  rootFile: string,
  engine: LatexEngine
): Promise<{ pdfBytes: Buffer; warnings: string[] }> {
  const pdfPath = join(tempDir, buildPdfOutputPath(rootFile));
  try {
    await execFileAsync(engine.binary, engine.buildArgs(rootFile), {
      cwd: tempDir,
      timeout: 300_000,
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (error) {
    // -interaction=nonstopmode continues past document errors and still writes
    // a PDF. If one was produced, return it with the real errors surfaced as
    // warnings instead of failing the whole compile on a missing icon or an
    // undefined environment (the misleading "Missing input file .nav" noise).
    try {
      const pdfBytes = await readFile(pdfPath);
      const logData = await readMainLogIfAvailable(tempDir, rootFile);
      const warnings = logData ? diagnoseLatexErrors(logData.text) : [];
      return { pdfBytes, warnings };
    } catch {
      throw error;
    }
  }

  const pdfBytes = await readFile(pdfPath);
  return { pdfBytes, warnings: [] };
}

// Writes the project into a fresh temp dir (text files, inline images, .bib
// stubs, and stored figures). Each engine gets its own fresh dir so a previous
// engine's generated files (.fdb_latexmk, .aux, .nav) can't make the next one
// a no-op.
async function prepareCompileDir(
  files: CompileInputFile[],
  rootFile: string,
  userId: string | null,
  projectId: string | undefined,
  corruptFigures: string[] = [],
  persistent = false
): Promise<string> {
  let tempDir: string;
  if (persistent && userId && projectId) {
    tempDir = buildDirPath(userId, projectId);
    await mkdir(tempDir, { recursive: true });
  } else {
    tempDir = await mkdtemp(join(tmpdir(), "wiserfiles-latex-"));
  }

  const fileMap = new Map<string, string>();
  for (const file of files) {
    if (!file || typeof file.path !== "string" || typeof file.content !== "string") {
      throw new Error("Each file must include string path and content.");
    }
    const path = file.path.trim();
    if (!isSafeProjectPath(path)) {
      throw new Error(`Unsafe file path: ${path}`);
    }
    fileMap.set(path, file.content);
  }

  if (!fileMap.has(rootFile)) {
    throw new Error(`Root file not found in project: ${rootFile}`);
  }

  for (const [path, content] of fileMap.entries()) {
    const targetPath = join(tempDir, path);
    await mkdir(dirname(targetPath), { recursive: true });
    // When reusing a persistent build dir, only rewrite files whose bytes
    // actually changed so latexmk's .fdb_latexmk keeps them as up-to-date and
    // skips the work (fast recompiles).
    if (persistent && userId && projectId) {
      const unchanged = await fileBytesEqual(targetPath, projectFileBytes(path, content));
      if (unchanged) continue;
    }
    await writeProjectFile(targetPath, path, content);
  }

  // Create empty .bib files for any \bibliography{} references that have no
  // matching file, so bibtex/biber doesn't fail.
  for (const [path, content] of fileMap.entries()) {
    if (!path.endsWith(".tex")) continue;
    const bibMatches = content.matchAll(/\\bibliography\{([^}]+)\}/g);
    for (const match of bibMatches) {
      const bibFiles = match[1].split(",").map((s) => s.trim());
      for (const bibFile of bibFiles) {
        const bibPath = bibFile.endsWith(".bib") ? bibFile : `${bibFile}.bib`;
        const relPath = bibPath.startsWith("/") ? bibPath.slice(1) : bibPath;
        const targetPath = join(tempDir, relPath);
        if (!fileMap.has(relPath)) {
          await mkdir(dirname(targetPath), { recursive: true });
          await writeFile(targetPath, "% Auto-generated empty bibliography\n", "utf8");
        } else if (!content || !content.trim()) {
          await mkdir(dirname(targetPath), { recursive: true });
          await writeFile(targetPath, "% Auto-generated empty bibliography\n", "utf8");
        }
      }
    }
  }

  // Beamer writes .nav/.toc/.snm/.out/.vrb at \end{document} and reads them on
  // the next pass. Pre-create empty stubs so latexmk's first pass never sees
  // "No file X.nav." and reports a misleading "Missing input file" when the
  // document also has an unrelated error (e.g. an undefined environment).
  const usesBeamer = [...fileMap.values()].some((c) =>
    /\\documentclass(?:\[[^\]]*\])?\{beamer\}/.test(c)
  );
  if (usesBeamer) {
    const rootBase = rootFile.replace(/\.tex$/i, "");
    for (const ext of ["nav", "toc", "snm", "out", "vrb"]) {
      const stubPath = `${rootBase}.${ext}`;
      if (!fileMap.has(stubPath)) {
        const targetPath = join(tempDir, stubPath);
        await mkdir(dirname(targetPath), { recursive: true });
        await writeFile(targetPath, "", "utf8");
      }
    }
  }

  // Copy stored project figures into the compile dir.
  if (projectId && userId) {
    await copyAssetsRecursive(
      join(ASSETS_ROOT, userId, sanitizeAssetPath(projectId)),
      tempDir,
      corruptFigures
    );
  }

  return tempDir;
}

// Serve the compiled project's SyncTeX data (main.synctex.gz) so the client can
// map PDF text <-> source lines. Reads from the persistent per-project build
// dir used by the latexmk engine.
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const url = new URL(request.url);
  if (url.searchParams.get("synctex") !== "1") return jsonError("Missing synctex parameter.", 400);
  const rootFile = (url.searchParams.get("root") || "main.tex").trim();
  const projectId = url.searchParams.get("projectId");
  if (!projectId) return jsonError("projectId is required.", 400);
  if (!isSafeProjectPath(rootFile) || !rootFile.toLowerCase().endsWith(".tex")) {
    return jsonError("Invalid root LaTeX file path.", 400);
  }

  const synctexFileName = buildSynctexPath(rootFile);
  const synctexPath = join(buildDirPath(userId, projectId), synctexFileName);
  try {
    const bytes = await readFile(synctexPath);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="${synctexFileName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return jsonError("SyncTeX data not found. Recompile the project.", 404);
  }
}

export async function POST(request: Request) {
  const { userId } = await auth();
  // Guests may compile a limited number of times (gated client-side too);
  // rate-limit by user when signed in, otherwise by IP.
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "anonymous";
  const rateKey = userId ? `latex-compile:${userId}` : `latex-compile:guest:${ip}`;
  const limited = userId
    ? !checkRateLimit(rateKey)
    : !checkGuestRateLimit(rateKey);
  if (limited) {
    return jsonError("Compile limit reached. Sign in for unlimited compiling.", 429);
  }

  let payload: CompileRequestPayload;

  try {
    payload = (await request.json()) as CompileRequestPayload;
  } catch {
    return jsonError("Invalid JSON payload.", 400);
  }

  const files = payload.files ?? [];
  if (!Array.isArray(files) || !files.length) {
    return jsonError("Provide at least one project file to compile.", 400);
  }

  const rootFile = (payload.rootFile || "main.tex").trim();
  if (!isSafeProjectPath(rootFile) || !rootFile.toLowerCase().endsWith(".tex")) {
    return jsonError("Invalid root LaTeX file path.", 400);
  }

  let hasMissingEngine = false;
  const engineErrors: string[] = [];
  const autoInstallAttempts = new Set<string>();
  const corruptFigures: string[] = [];
  let lastLogData: { text?: string; fileName?: string } | null = null;

  // Incremental builds: reuse a per-project build dir so latexmk can skip
  // unchanged work via its .fdb_latexmk dependency tracking. A "clean" request
  // (or an oversized dir) resets it.
  const usePersistentBuild = Boolean(userId && payload.projectId);
  if (usePersistentBuild) {
    const buildDir = buildDirPath(userId!, payload.projectId!);
    if (payload.clean) {
      await rm(buildDir, { recursive: true, force: true });
    } else {
      const size = await dirSizeRecursive(buildDir);
      if (size > BUILD_DIR_MAX_BYTES) {
        await rm(buildDir, { recursive: true, force: true });
      }
    }
  }

  for (const engine of ENGINES) {
    let tempDir: string | null = null;
    let tempDirPersistent = false;
    try {
      const persistent = engine.name === "latexmk" && usePersistentBuild;
      tempDir = await prepareCompileDir(files, rootFile, userId, payload.projectId, corruptFigures, persistent);
      tempDirPersistent = persistent;
      const { pdfBytes, warnings } = await compileWithEngine(tempDir, rootFile, engine);
      const outputName = sanitizeFileName(buildPdfOutputPath(rootFile));

      const headers: Record<string, string> = {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${outputName}"`,
        "Cache-Control": "no-store",
        "X-Latex-Engine": engine.name,
      };
      if (warnings.length) {
        headers["X-Latex-Warnings"] = warnings.join(" | ");
      }

      return new Response(new Uint8Array(pdfBytes), { status: 200, headers });
    } catch (error) {
      if (tempDir && !lastLogData) {
        lastLogData = await readMainLogIfAvailable(tempDir, rootFile);
      }
      const maybeCode = error as { code?: string };
      const detail = extractErrorDetail(error);
      const missingBinary =
        maybeCode.code === "ENOENT" || detail.toLowerCase().includes("command not found");

      if (missingBinary) {
        hasMissingEngine = true;
        continue;
      }

      const missingSty = extractMissingStyName(detail);
      if (missingSty && !autoInstallAttempts.has(missingSty)) {
        autoInstallAttempts.add(missingSty);
        const installResult = await tryAutoInstallMissingSty(missingSty);

        if (installResult.ok) {
          let retryDir: string | null = null;
          try {
            retryDir = await prepareCompileDir(files, rootFile, userId, payload.projectId, corruptFigures);
            const { pdfBytes, warnings } = await compileWithEngine(retryDir, rootFile, engine);
            const outputName = sanitizeFileName(buildPdfOutputPath(rootFile));

            const retryHeaders: Record<string, string> = {
              "Content-Type": "application/pdf",
              "Content-Disposition": `attachment; filename="${outputName}"`,
              "Cache-Control": "no-store",
              "X-Latex-Engine": engine.name,
              "X-Latex-Autoinstall":
                installResult.manager === "tlmgr"
                  ? `tlmgr:${installResult.mode}:${installResult.packageName}`
                  : `apt:${installResult.packageName}`,
            };
            if (warnings.length) {
              retryHeaders["X-Latex-Warnings"] = warnings.join(" | ");
            }

            return new Response(new Uint8Array(pdfBytes), { status: 200, headers: retryHeaders });
          } catch (retryError) {
            const retryDetail = extractErrorDetail(retryError);
            const retryHint = getMissingStyPackageHint(retryDetail);
            engineErrors.push(
              `${engine.name} (after auto-install): ${retryDetail}${retryHint ? `\nHint: ${retryHint}` : ""}`
            );
            continue;
          } finally {
            if (retryDir) await rm(retryDir, { recursive: true, force: true });
          }
        }

        engineErrors.push(
          `${engine.name} (auto-install failed for ${missingSty}.sty): ${installResult.detail}`
        );
      }

      const hint = getMissingStyPackageHint(detail);
      engineErrors.push(`${engine.name}: ${detail}${hint ? `\nHint: ${hint}` : ""}`);
    } finally {
      if (tempDir && !tempDirPersistent) {
        await rm(tempDir, { recursive: true, force: true });
      }
    }
  }

  if (hasMissingEngine && !engineErrors.length) {
    return jsonError(
      "No LaTeX engine available. Install texliveonfly, tectonic, or latexmk on the server host.",
      503,
      lastLogData?.text,
      lastLogData?.fileName
    );
  }

  if (engineErrors.length) {
    const missing = diagnoseMissingFigures(engineErrors);
    const corrupt = [...new Set(corruptFigures)];
    let message = `LaTeX compile failed.\n${engineErrors.join("\n\n")}`;
    if (corrupt.length) {
      message +=
        `\n\nCorrupt figures: ${corrupt.join(", ")}. ` +
        "These files failed image validation on the server and were not compiled — re-import the project to repair them.";
    }
    if (missing.length) {
      message += `\n\nMissing figures: ${missing.join(", ")}.`;
      message +=
        " These are usually image files that did not reach the compiler — " +
        "re-compile to re-upload them, or re-import the project.";
    }
    return jsonError(message, 500, lastLogData?.text, lastLogData?.fileName);
  }

  return jsonError(
    "Unable to compile LaTeX project.",
    500,
    lastLogData?.text,
    lastLogData?.fileName
  );
}
