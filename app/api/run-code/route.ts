import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { auth } from "@clerk/nextjs/server";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 30;
const rateLimitMap = new Map<string, number[]>();

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const times = (rateLimitMap.get(key) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (times.length >= RATE_MAX_REQUESTS) return false;
  times.push(now);
  rateLimitMap.set(key, times);
  return true;
}

type RunCodePayload = {
  code: string;
  language: "python" | "cpp";
};

type RunCodeResponse = {
  output: string;
  error: string;
  exitCode: number;
};

const TIMEOUT_MS = 15_000;
const MAX_OUTPUT_BYTES = 100_000;

function truncateOutput(raw: string): string {
  if (Buffer.byteLength(raw, "utf8") <= MAX_OUTPUT_BYTES) return raw;
  const truncated = Buffer.from(raw, "utf8").subarray(0, MAX_OUTPUT_BYTES).toString("utf8");
  return truncated + "\n\n[Output truncated at 100KB]";
}

async function runPython(code: string, tempDir: string): Promise<RunCodeResponse> {
  const scriptPath = join(tempDir, "script.py");
  await writeFile(scriptPath, code, "utf8");

  try {
    const result = await execFileAsync("python3", [scriptPath], {
      cwd: tempDir,
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
      env: {
        ...process.env,
        HOME: tempDir,
        TMPDIR: tempDir,
        PATH: process.env.PATH || "/usr/bin:/bin",
        PYTHONDONTWRITEBYTECODE: "1",
      },
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

async function runCpp(code: string, tempDir: string): Promise<RunCodeResponse> {
  const sourcePath = join(tempDir, "program.cpp");
  const binaryPath = join(tempDir, "program");

  await writeFile(sourcePath, code, "utf8");

  // Compile
  try {
    await execFileAsync("g++", [
      "-std=c++17",
      "-O2",
      "-Wall",
      "-o",
      binaryPath,
      sourcePath,
    ], {
      timeout: 30_000,
      maxBuffer: MAX_OUTPUT_BYTES,
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
      env: {
        ...process.env,
        HOME: tempDir,
        TMPDIR: tempDir,
        PATH: process.env.PATH || "/usr/bin:/bin",
      },
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

  if (!payload.code || typeof payload.code !== "string") {
    return jsonError("Provide a 'code' string.", 400);
  }

  if (!payload.language || !["python", "cpp"].includes(payload.language)) {
    return jsonError("Language must be 'python' or 'cpp'.", 400);
  }

  const code = payload.code;
  if (Buffer.byteLength(code, "utf8") > 2 * 1024 * 1024) {
    return jsonError("Code payload exceeds 2MB limit.", 400);
  }

  // Block dangerous imports/system calls for Python (basic sandbox)
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
      if (pattern.test(code)) {
        return jsonError("Code contains restricted operations.", 403);
      }
    }
  }

  // For C++, block includes that access the filesystem
  if (payload.language === "cpp") {
    const blockedIncludes = [
      /#include\s*[<"]filesystem[>"]/,
      /#include\s*[<"]fstream[>"]/,
      /#include\s*[<"]cstdio[>"]/,
      /#include\s*[<"]unistd\.h[>"]/,
      /#include\s*[<"]fcntl\.h[>"]/,
    ];
    for (const pattern of blockedIncludes) {
      if (pattern.test(code)) {
        return jsonError("Code contains restricted includes.", 403);
      }
    }
  }

  const tempDir = await mkdtemp(join(tmpdir(), "wiserfiles-code-"));

  try {
    let result: RunCodeResponse;
    if (payload.language === "python") {
      result = await runPython(code, tempDir);
    } else {
      result = await runCpp(code, tempDir);
    }

    return Response.json(result);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
