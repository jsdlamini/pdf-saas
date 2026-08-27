// Standalone sandbox runner. Runs allowlisted commands with execFile (no
// shell) in a fresh temp dir holding the caller's files, with a stripped-down
// environment, a timeout, and a capped output buffer.
//
// Runs in its own container with NO app secrets and NO network route to the
// database, so a compromised command cannot reach the app's environment or
// data. The web container talks to it over a private network.

import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PORT = Number(process.env.SANDBOX_PORT || 3100);
const TIMEOUT_MS = 30_000;
const MAX_OUTPUT = 64 * 1024;

const ALLOWED = new Set([
  "pdflatex", "latexmk", "lualatex", "xelatex", "bibtex", "biber",
  "python3", "python", "g++", "gcc", "clang++", "clang", "make", "cmake",
  "git", "ls", "cat", "pwd", "echo", "mkdir", "rm", "cp", "mv",
  "find", "grep", "head", "tail", "wc", "touch", "chmod", "du", "df",
]);

function splitCommand(input) {
  const tokens = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(input)) !== null) {
    tokens.push(m[1] ?? m[2] ?? m[3]);
  }
  return tokens;
}

function sanitizePath(path) {
  const safe = String(path).replace(/^\/+/, "").replace(/\\/g, "/");
  if (!safe || safe.includes("..") || safe.includes(":")) return null;
  const parts = safe.split("/").filter((p) => p && p !== "." && p !== "..");
  return parts.length ? parts.join("/") : null;
}

const server = createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/run") {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }

  let raw = "";
  for await (const chunk of req) raw += chunk;

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "invalid json" }));
    return;
  }

  const command = String(body?.command || "").trim();
  const files = Array.isArray(body?.files) ? body.files : [];
  const argv = splitCommand(command);
  const full = argv[0] || "";
  const name = full.split("/").pop() || full;

  if (!name || !ALLOWED.has(name)) {
    res.writeHead(403, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: `Command "${name}" is not allowed.` }));
    return;
  }

  const tempDir = await mkdtemp(join(tmpdir(), "sandbox-"));
  try {
    for (const file of files) {
      if (!file || typeof file.path !== "string" || typeof file.content !== "string") continue;
      const safe = sanitizePath(file.path);
      if (!safe) continue;
      const target = join(tempDir, safe);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content, "utf8");
    }

    const env = {
      PATH: process.env.PATH || "/usr/bin:/bin",
      HOME: tempDir,
      TMPDIR: tempDir,
      LANG: "C.UTF-8",
    };

    try {
      const result = await execFileAsync(name, argv.slice(1), {
        cwd: tempDir,
        env,
        timeout: TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT,
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        exitCode: 0,
        stdout: result.stdout.slice(0, MAX_OUTPUT),
        stderr: result.stderr.slice(0, MAX_OUTPUT),
      }));
    } catch (error) {
      const e = error;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        exitCode: typeof e.code === "number" ? e.code : 1,
        killed: Boolean(e.killed),
        stdout: (e.stdout || "").slice(0, MAX_OUTPUT),
        stderr: (e.stderr || "").slice(0, MAX_OUTPUT),
      }));
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`sandbox-runner listening on ${PORT}`);
});
