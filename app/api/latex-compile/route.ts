import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, normalize } from "node:path";
import { promisify } from "node:util";
import { auth } from "@clerk/nextjs/server";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 15;
const GUEST_RATE_WINDOW_MS = 60 * 60 * 1000;
const GUEST_RATE_MAX_REQUESTS = 10;
const rateLimitMap = new Map<string, number[]>();

function checkRateLimit(key: string, windowMs = RATE_WINDOW_MS, maxRequests = RATE_MAX_REQUESTS): boolean {
  const now = Date.now();
  const times = (rateLimitMap.get(key) || []).filter((t) => now - t < windowMs);
  if (times.length >= maxRequests) return false;
  times.push(now);
  rateLimitMap.set(key, times);
  return true;
}

type CompileInputFile = {
  path: string;
  content: string;
};

type CompileRequestPayload = {
  rootFile?: string;
  files?: CompileInputFile[];
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
    buildArgs: (rootFile) => ["-pdf", "-interaction=nonstopmode", "-file-line-error", rootFile],
  },
  {
    name: "texliveonfly",
    binary: "texliveonfly",
    buildArgs: (rootFile) => [
      "--compiler",
      "latexmk",
      "--arguments",
      "-pdf -interaction=nonstopmode -file-line-error",
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
  // Runtime now runs as a non-root user with passwordless sudo scoped to
  // apt-get/tlmgr via /etc/sudoers.d/app.
  return true;
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

async function compileWithEngine(tempDir: string, rootFile: string, engine: LatexEngine) {
  await execFileAsync(engine.binary, engine.buildArgs(rootFile), {
    cwd: tempDir,
    timeout: 120_000,
    maxBuffer: 32 * 1024 * 1024,
  });

  const pdfPath = join(tempDir, buildPdfOutputPath(rootFile));
  const pdfBytes = await readFile(pdfPath);
  return pdfBytes;
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
    : !checkRateLimit(rateKey, GUEST_RATE_WINDOW_MS, GUEST_RATE_MAX_REQUESTS);
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

  const tempDir = await mkdtemp(join(tmpdir(), "wiserfiles-latex-"));

  try {
    const fileMap = new Map<string, string>();
    for (const file of files) {
      if (!file || typeof file.path !== "string" || typeof file.content !== "string") {
        return jsonError("Each file must include string path and content.", 400);
      }

      const path = file.path.trim();
      if (!isSafeProjectPath(path)) {
        return jsonError(`Unsafe file path: ${path}`, 400);
      }

      fileMap.set(path, file.content);
    }

    if (!fileMap.has(rootFile)) {
      return jsonError(`Root file not found in project: ${rootFile}`, 400);
    }

    for (const [path, content] of fileMap.entries()) {
      const targetPath = join(tempDir, path);
      await mkdir(dirname(targetPath), { recursive: true });
      // Binary assets (figures, images, PDFs) are stored as base64 strings;
      // decode them so LaTeX can actually use them.
      if (/\.(png|jpg|jpeg|gif|pdf|eps|svg)$/i.test(path)) {
        await writeFile(targetPath, Buffer.from(content, "base64"));
      } else {
        await writeFile(targetPath, content, "utf8");
      }
    }

    // Create empty .bib files for any \bibliography{} references that have no matching file
    // Also ensure existing .bib files have at least minimal content so bibtex doesn't fail
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

    let hasMissingEngine = false;
    const engineErrors: string[] = [];
    const autoInstallAttempts = new Set<string>();

    for (const engine of ENGINES) {
      try {
        const pdfBytes = await compileWithEngine(tempDir, rootFile, engine);
        const outputName = sanitizeFileName(buildPdfOutputPath(rootFile));

        return new Response(pdfBytes, {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${outputName}"`,
            "Cache-Control": "no-store",
            "X-Latex-Engine": engine.name,
          },
        });
      } catch (error) {
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
            try {
              const pdfBytes = await compileWithEngine(tempDir, rootFile, engine);
              const outputName = sanitizeFileName(buildPdfOutputPath(rootFile));

              return new Response(pdfBytes, {
                status: 200,
                headers: {
                  "Content-Type": "application/pdf",
                  "Content-Disposition": `attachment; filename="${outputName}"`,
                  "Cache-Control": "no-store",
                  "X-Latex-Engine": engine.name,
                  "X-Latex-Autoinstall":
                    installResult.manager === "tlmgr"
                      ? `tlmgr:${installResult.mode}:${installResult.packageName}`
                      : `apt:${installResult.packageName}`,
                },
              });
            } catch (retryError) {
              const retryDetail = extractErrorDetail(retryError);
              const retryHint = getMissingStyPackageHint(retryDetail);
              engineErrors.push(
                `${engine.name} (after auto-install): ${retryDetail}${retryHint ? `\nHint: ${retryHint}` : ""}`
              );
              continue;
            }
          }

          engineErrors.push(
            `${engine.name} (auto-install failed for ${missingSty}.sty): ${installResult.detail}`
          );
        }

        const hint = getMissingStyPackageHint(detail);
        engineErrors.push(`${engine.name}: ${detail}${hint ? `\nHint: ${hint}` : ""}`);
      }
    }

    if (hasMissingEngine && !engineErrors.length) {
      const logData = await readMainLogIfAvailable(tempDir, rootFile);
      return jsonError(
        "No LaTeX engine available. Install texliveonfly, tectonic, or latexmk on the server host.",
        503,
        logData?.text,
        logData?.fileName
      );
    }

    if (engineErrors.length) {
      const logData = await readMainLogIfAvailable(tempDir, rootFile);
      return jsonError(
        `LaTeX compile failed.\n${engineErrors.join("\n\n")}`,
        500,
        logData?.text,
        logData?.fileName
      );
    }

    const logData = await readMainLogIfAvailable(tempDir, rootFile);
    return jsonError("Unable to compile LaTeX project.", 500, logData?.text, logData?.fileName);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
