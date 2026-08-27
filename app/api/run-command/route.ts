import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { auth } from "@clerk/nextjs/server";
import { sandboxedEnv } from "@/lib/exec-sandbox";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tier-1 terminal: an allowlisted single command, run with execFile (no shell)
// in a fresh temp dir holding the project's text files, with a stripped-down
// environment (no app secrets), a timeout, and a capped output buffer.
const ALLOWED_COMMANDS = new Set([
  "pdflatex", "latexmk", "lualatex", "xelatex", "bibtex", "biber",
  "python3", "python", "g++", "gcc", "clang++", "clang", "make", "cmake",
  "git", "ls", "cat", "pwd", "echo", "mkdir", "rm", "cp", "mv",
  "find", "grep", "head", "tail", "wc", "touch", "chmod", "du", "df",
]);

const COMMAND_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 20;
const rateLimitMap = new Map<string, number[]>();

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const times = (rateLimitMap.get(key) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (times.length >= RATE_MAX) return false;
  times.push(now);
  rateLimitMap.set(key, times);
  return true;
}

// Split a command line into argv, honouring single/double quotes.
function splitCommand(input: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    tokens.push(m[1] ?? m[2] ?? m[3]);
  }
  return tokens;
}

function sanitizePath(path: string): string | null {
  const safe = path.replace(/^\/+/, "").replace(/\\/g, "/");
  if (!safe || safe.includes("..") || safe.includes(":")) return null;
  const parts = safe.split("/").filter((p) => p && p !== "." && p !== "..");
  return parts.length ? parts.join("/") : null;
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);
  if (!checkRateLimit(`run-command:${userId}`)) {
    return jsonError("Too many commands. Wait a minute and try again.", 429);
  }

  const body = (await request.json().catch(() => null)) as {
    command?: string;
    files?: Array<{ path: string; content: string }>;
  } | null;
  const command = (body?.command || "").trim();
  if (!command) return jsonError("Enter a command.", 400);

  const argv = splitCommand(command);
  const full = argv[0] || "";
  const name = full.split("/").pop() || full;
  if (!ALLOWED_COMMANDS.has(name)) {
    return jsonError(`Command "${name}" is not allowed.`, 403);
  }

  const tempDir = await mkdtemp(join(tmpdir(), "wiserfiles-runcmd-"));
  try {
    // Write the project's text files so compile commands have their sources.
    for (const file of body?.files ?? []) {
      if (!file || typeof file.path !== "string" || typeof file.content !== "string") continue;
      const safe = sanitizePath(file.path);
      if (!safe) continue;
      const target = join(tempDir, safe);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content, "utf8");
    }

    try {
      const result = await execFileAsync(name, argv.slice(1), {
        cwd: tempDir,
        env: sandboxedEnv(tempDir),
        timeout: COMMAND_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
      });
      return Response.json({
        exitCode: 0,
        stdout: result.stdout.slice(0, MAX_OUTPUT_BYTES),
        stderr: result.stderr.slice(0, MAX_OUTPUT_BYTES),
      });
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string; code?: number | string; killed?: boolean };
      return Response.json({
        exitCode: typeof e.code === "number" ? e.code : 1,
        killed: Boolean(e.killed),
        stdout: (e.stdout || "").slice(0, MAX_OUTPUT_BYTES),
        stderr: (e.stderr || "").slice(0, MAX_OUTPUT_BYTES),
      });
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
