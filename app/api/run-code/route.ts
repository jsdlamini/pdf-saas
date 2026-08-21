import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { auth } from "@clerk/nextjs/server";
import { sandboxedEnv } from "@/lib/exec-sandbox";
import { createRateLimiter } from "@/lib/rate-limit";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 30;
const checkRateLimit = createRateLimiter(RATE_WINDOW_MS, RATE_MAX_REQUESTS);

type ProjectFile = { path: string; content: string };

type RunCodePayload = {
  language: "python" | "cpp";
  files: ProjectFile[];
  mainPath: string;
};

type RunCodeResponse = {
  output: string;
  error: string;
  exitCode: number;
};

const TIMEOUT_MS = 15_000;
const MAX_OUTPUT_BYTES = 100_000;
const MAX_TOTAL_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_FILE_COUNT = 500;

function truncateOutput(raw: string): string {
  if (Buffer.byteLength(raw, "utf8") <= MAX_OUTPUT_BYTES) return raw;
  const truncated = Buffer.from(raw, "utf8").subarray(0, MAX_OUTPUT_BYTES).toString("utf8");
  return truncated + "\n\n[Output truncated at 100KB]";
}

// Normalise a project-relative path and drop any traversal segments so every
// written file stays inside the temp directory.
function sanitizeRelPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\/+/, "");
  const parts = normalized.split("/").filter((p) => p && p !== "." && p !== "..");
  return parts.length ? parts.join("/") : "main";
}

async function writeProjectFiles(files: ProjectFile[], tempDir: string): Promise<void> {
  for (const file of files) {
    const safe = sanitizeRelPath(file.path);
    const full = join(tempDir, safe);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, file.content, "utf8");
  }
}

function findMainPath(files: ProjectFile[], mainPath: string): string {
  const candidates = new Set(files.map((f) => sanitizeRelPath(f.path)));
  const main = sanitizeRelPath(mainPath);
  if (candidates.has(main)) return main;
  const byBasename = files.find((f) => sanitizeRelPath(f.path).split("/").pop() === mainPath.split("/").pop());
  if (byBasename) return sanitizeRelPath(byBasename.path);
  return files[0] ? sanitizeRelPath(files[0].path) : "main";
}

async function runPython(mainPath: string, tempDir: string): Promise<RunCodeResponse> {
  const scriptPath = join(tempDir, mainPath);

  try {
    const result = await execFileAsync("python3", [scriptPath], {
      cwd: tempDir,
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
      env: sandboxedEnv(tempDir, { PYTHONDONTWRITEBYTECODE: "1" }),
    });

    return {
      output: truncateOutput(result.stdout || ""),
      error: result.stderr || "",
      exitCode: 0,
    };
  } catch (err) {
    const error = err as { stdout?: string; stderr?: string; code?: number; killed?: boolean };
    if (error.killed) {
      return {
        output: "",
        error: "Execution timed out after 15 seconds.",
        exitCode: 124,
      };
    }
    return {
      output: truncateOutput(error.stdout || ""),
      error: error.stderr || `Process exited with code ${error.code ?? 1}`,
      exitCode: error.code ?? 1,
    };
  }
}

async function runCpp(sourceFiles: string[], tempDir: string): Promise<RunCodeResponse> {
  const binaryPath = join(tempDir, "program");

  // Compile every C++ source file so multi-file projects (main.cpp +
  // samples.cpp) link correctly instead of failing with undefined references.
  try {
    await execFileAsync("g++", [
      "-std=c++17",
      "-O2",
      "-Wall",
      "-o",
      binaryPath,
      ...sourceFiles.map((f) => join(tempDir, f)),
    ], {
      timeout: 30_000,
      maxBuffer: MAX_OUTPUT_BYTES,
      env: sandboxedEnv(tempDir),
    });
  } catch (err) {
    const error = err as { stdout?: string; stderr?: string; code?: number };
    return {
      output: "",
      error: error.stderr || error.stdout || "Compilation failed.",
      exitCode: error.code ?? 1,
    };
  }

  // Make executable
  await chmod(binaryPath, 0o755);

  // Run
  try {
    const result = await execFileAsync(binaryPath, [], {
      cwd: tempDir,
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
      env: sandboxedEnv(tempDir),
    });

    return {
      output: truncateOutput(result.stdout || ""),
      error: result.stderr || "",
      exitCode: 0,
    };
  } catch (err) {
    const error = err as { stdout?: string; stderr?: string; code?: number; killed?: boolean };
    if (error.killed) {
      return {
        output: "",
        error: "Execution timed out after 15 seconds.",
        exitCode: 124,
      };
    }
    return {
      output: truncateOutput(error.stdout || ""),
      error: error.stderr || `Process exited with code ${error.code ?? 1}`,
      exitCode: error.code ?? 1,
    };
  }
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return jsonError("Sign in required.", 401);
  }
  if (!checkRateLimit(`run-code:${userId}`)) {
    return jsonError("Rate limit exceeded. Try again shortly.", 429);
  }

  let payload: RunCodePayload;

  try {
    payload = (await request.json()) as RunCodePayload;
  } catch {
    return jsonError("Invalid JSON payload.", 400);
  }

  if (!payload.language || !["python", "cpp"].includes(payload.language)) {
    return jsonError("Language must be 'python' or 'cpp'.", 400);
  }

  const files = Array.isArray(payload.files) ? payload.files : [];
  if (!files.length) {
    return jsonError("Provide at least one source 'file'.", 400);
  }
  if (files.length > MAX_FILE_COUNT) {
    return jsonError(`Too many files (max ${MAX_FILE_COUNT}).`, 400);
  }

  for (const file of files) {
    if (!file || typeof file.path !== "string" || typeof file.content !== "string") {
      return jsonError("Each file must have 'path' and 'content' strings.", 400);
    }
  }

  const totalBytes = files.reduce((sum, f) => sum + Buffer.byteLength(f.content, "utf8"), 0);
  if (totalBytes > MAX_TOTAL_SOURCE_BYTES) {
    return jsonError("Source files exceed the 4MB total limit.", 400);
  }

  const allCode = files.map((f) => f.content).join("\n");

  // Block dangerous imports/system calls for Python (basic sandbox).
  if (payload.language === "python") {
    const dangerousPatterns = [
      /\bos\.system\b/,
      /\bsubprocess\b/,
      /\bexec\b/,
      /\beval\b/,
      /\bcompile\b/,
      /\b__import__\b/,
      /\bopen\b/,
      /\bshutil\b/,
      /\bsocket\b/,
      /\brequests\b/,
    ];
    for (const pattern of dangerousPatterns) {
      if (pattern.test(allCode)) {
        return jsonError("Code contains restricted operations.", 403);
      }
    }
  }

  // For C++, block includes that access the filesystem.
  if (payload.language === "cpp") {
    const blockedIncludes = [
      /#include\s*[<"]filesystem[>"]/,
      /#include\s*[<"]fstream[>"]/,
      /#include\s*[<"]cstdio[>"]/,
      /#include\s*[<"]unistd\.h[>"]/,
      /#include\s*[<"]fcntl\.h[>"]/,
    ];
    for (const pattern of blockedIncludes) {
      if (pattern.test(allCode)) {
        return jsonError("Code contains restricted includes.", 403);
      }
    }
  }

  const tempDir = await mkdtemp(join(tmpdir(), "wiserfiles-code-"));

  try {
    await writeProjectFiles(files, tempDir);
    const mainPath = findMainPath(files, payload.mainPath || files[0].path);

    let result: RunCodeResponse;
    if (payload.language === "python") {
      result = await runPython(mainPath, tempDir);
    } else {
      // Compile all C/C++ sources so multi-file projects link.
      const sourceFiles = files
        .map((f) => sanitizeRelPath(f.path))
        .filter((p) => /\.(cpp|cc|cxx|c)$/i.test(p));
      const sources = sourceFiles.includes(mainPath)
        ? sourceFiles
        : [mainPath, ...sourceFiles];
      result = await runCpp(sources, tempDir);
    }

    return Response.json(result);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
