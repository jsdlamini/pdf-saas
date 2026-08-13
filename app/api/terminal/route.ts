import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { auth } from "@clerk/nextjs/server";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 15_000;
const MAX_OUTPUT_BYTES = 200_000;
const MAX_COMMAND_LENGTH = 2_000;

// Simple in-memory rate limiter (per-user, per-window)
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 20;
const rateLimitMap = new Map<string, number[]>();

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const times = (rateLimitMap.get(key) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (times.length >= RATE_MAX_REQUESTS) return false;
  times.push(now);
  rateLimitMap.set(key, times);
  return true;
}

function truncateOutput(raw: string): string {
  if (Buffer.byteLength(raw, "utf8") <= MAX_OUTPUT_BYTES) return raw;
  const truncated = Buffer.from(raw, "utf8").subarray(0, MAX_OUTPUT_BYTES).toString("utf8");
  return truncated + "\n\n[Output truncated at 200KB]";
}

const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-rf[a-zA-Z]*)\b/, message: "rm with recursive/force flags is blocked" },
  { pattern: /\bsudo\b/, message: "sudo is blocked" },
  { pattern: /\bchmod\s+.*777\b/, message: "chmod 777 is blocked" },
  { pattern: /\bcurl\b.+\b(https?:\/\/|ftp:\/\/)/, message: "curl to external hosts is blocked" },
  { pattern: /\bwget\b.+\b(https?:\/\/|ftp:\/\/)/, message: "wget to external hosts is blocked" },
  { pattern: /\bkill\b/, message: "kill is blocked" },
  { pattern: /\breboot\b/, message: "reboot is blocked" },
  { pattern: /\bshutdown\b/, message: "shutdown is blocked" },
  { pattern: /\bdd\b/, message: "dd is blocked" },
  { pattern: /\bmkfs\b/, message: "mkfs is blocked" },
  { pattern: />\s*\/dev\//, message: "writing to /dev/ devices is blocked" },
];

function checkDangerousCommand(command: string): string | null {
  const trimmed = command.trim();
  if (!trimmed) return "Empty command.";

  if (trimmed.length > MAX_COMMAND_LENGTH) {
    return `Command exceeds ${MAX_COMMAND_LENGTH} character limit.`;
  }

  for (const { pattern, message } of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      return message;
    }
  }

  return null;
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }
  if (!checkRateLimit(`terminal:${userId}`)) {
    return Response.json({ error: "Rate limit exceeded. Try again shortly." }, { status: 429 });
  }

  let payload: { command?: string; cwd?: string };

  try {
    payload = (await request.json()) as { command?: string; cwd?: string };
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  if (!payload.command || typeof payload.command !== "string") {
    return Response.json({ error: "Provide a 'command' string." }, { status: 400 });
  }

  // Validate cwd if provided — must be under /tmp/terminal-
  let cwdEnv: string | undefined;
  if (payload.cwd) {
    if (
      !payload.cwd.startsWith("/tmp/terminal-") ||
      payload.cwd.includes("..")
    ) {
      return Response.json(
        { error: "Invalid cwd. Must be under /tmp/terminal-*." },
        { status: 400 }
      );
    }
    cwdEnv = payload.cwd;
  }

  const danger = checkDangerousCommand(payload.command);
  if (danger) {
    return Response.json(
      { stdout: "", stderr: `Blocked: ${danger}`, exitCode: 1, cwd: cwdEnv || "" },
      { status: 200 }
    );
  }

  // Create a temp directory for this request
  const tempDir = await mkdtemp(join(tmpdir(), "terminal-"));
  const effectiveCwd = cwdEnv || tempDir;

  try {
    const result = await execFileAsync("bash", ["-c", payload.command], {
      cwd: effectiveCwd,
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
      env: {
        ...process.env,
        HOME: tempDir,
        TMPDIR: tempDir,
        PATH: process.env.PATH || "/usr/bin:/bin:/usr/local/bin",
        SHELL: "/bin/bash",
        TERM: "dumb",
        LANG: "en_US.UTF-8",
        LC_ALL: "en_US.UTF-8",
      },
    });

    return Response.json({
      stdout: truncateOutput(result.stdout || ""),
      stderr: result.stderr || "",
      exitCode: 0,
      cwd: effectiveCwd,
    });
  } catch (err) {
    const error = err as { stdout?: string; stderr?: string; code?: number; killed?: boolean };
    if (error.killed) {
      return Response.json({
        stdout: "",
        stderr: "",
        error: "Command timed out after 15s",
        exitCode: 124,
        cwd: effectiveCwd,
      });
    }

    return Response.json({
      stdout: truncateOutput(error.stdout || ""),
      stderr: error.stderr || `Process exited with code ${error.code ?? 1}`,
      exitCode: error.code ?? 1,
      cwd: effectiveCwd,
    });
  } finally {
    // Cleanup temp dir if we created it (not using a passed-in cwd)
    if (!cwdEnv) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
