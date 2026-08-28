// Standalone sandbox runner. Executes allowlisted commands and code jobs
// (Python/C++) with execFile (no shell) in a fresh temp dir, a stripped-down
// environment, a timeout, and a capped output buffer.
//
// Runs in its own container with NO app secrets and NO network route to the
// database or the internet. The web container talks to it over a private
// network via two endpoints:
//   POST /run   { command, files }            -> { stdout, stderr, exitCode }
//   POST /code  { language, files, mainPath } -> { output, error, exitCode }

import { execFile, spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// execFile's `input` option is unreliable (stdin never closes), so run
// commands that need stdin via spawn and write to stdin manually.
function execWithStdin(command, args, { stdin = "", timeout = CODE_TIMEOUT_MS, maxBuffer = MAX_OUTPUT, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const cap = () => {
      if (stdout.length > maxBuffer) stdout = stdout.slice(0, maxBuffer);
      if (stderr.length > maxBuffer) stderr = stderr.slice(0, maxBuffer);
    };
    child.stdout.on("data", (d) => { stdout += d; cap(); });
    child.stderr.on("data", (d) => { stderr += d; cap(); });
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeout);
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.on("close", (code) => {
      clearTimeout(timer);
      const info = { stdout, stderr, code: code ?? 1, killed: timedOut };
      if (timedOut) reject(Object.assign(new Error("Execution timed out"), info));
      else if (code !== 0) reject(Object.assign(new Error(`exit ${code}`), info));
      else resolve({ stdout, stderr, code: 0 });
    });
    child.stdin.on("error", () => {});
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

const PORT = Number(process.env.SANDBOX_PORT || 3100);
const TIMEOUT_MS = 30_000;
const CODE_TIMEOUT_MS = 15_000;
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

function sanitizeRelPath(path) {
  const normalized = String(path).replace(/\\/g, "/").replace(/^\.\/+/, "");
  const parts = normalized.split("/").filter((p) => p && p !== "." && p !== "..");
  return parts.length ? parts.join("/") : "main";
}

async function writeProjectFiles(files, tempDir) {
  for (const file of files) {
    if (!file || typeof file.path !== "string" || typeof file.content !== "string") continue;
    const safe = sanitizeRelPath(file.path);
    const full = join(tempDir, safe);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, file.content, "utf8");
  }
}

function findMainPath(files, mainPath) {
  const candidates = new Set(files.map((f) => sanitizeRelPath(f.path)));
  const main = sanitizeRelPath(mainPath || "");
  if (candidates.has(main)) return main;
  const base = (mainPath || "").split("/").pop();
  const byBasename = files.find((f) => sanitizeRelPath(f.path).split("/").pop() === base);
  if (byBasename) return sanitizeRelPath(byBasename.path);
  return files[0] ? sanitizeRelPath(files[0].path) : "main";
}

function truncateOutput(raw) {
  if (Buffer.byteLength(raw, "utf8") <= MAX_OUTPUT) return raw;
  return Buffer.from(raw, "utf8").subarray(0, MAX_OUTPUT).toString("utf8") + "\n\n[Output truncated]";
}

function sandboxedEnv(tempDir, extra = {}) {
  return {
    PATH: process.env.PATH || "/usr/bin:/bin",
    HOME: tempDir,
    TMPDIR: tempDir,
    LANG: "C.UTF-8",
    ...extra,
  };
}

async function runPython(mainPath, tempDir, stdin = "") {
  const scriptPath = join(tempDir, mainPath);
  try {
    const result = await execWithStdin("python3", [scriptPath], {
      stdin,
      timeout: CODE_TIMEOUT_MS,
      env: sandboxedEnv(tempDir, { PYTHONDONTWRITEBYTECODE: "1" }),
    });
    return { output: truncateOutput(result.stdout || ""), error: result.stderr || "", exitCode: 0 };
  } catch (err) {
    if (err.killed) return { output: "", error: "Execution timed out after 15 seconds.", exitCode: 124 };
    return {
      output: truncateOutput(err.stdout || ""),
      error: err.stderr || `Process exited with code ${err.code ?? 1}`,
      exitCode: err.code ?? 1,
    };
  }
}

async function runCpp(sourceFiles, tempDir, stdin = "") {
  const binaryPath = join(tempDir, "program");
  try {
    await execFileAsync("g++", ["-std=c++17", "-O2", "-Wall", "-o", binaryPath, ...sourceFiles.map((f) => join(tempDir, f))], {
      timeout: 30_000,
      maxBuffer: MAX_OUTPUT,
      env: sandboxedEnv(tempDir),
    });
  } catch (err) {
    return { output: "", error: err.stderr || err.stdout || "Compilation failed.", exitCode: err.code ?? 1 };
  }
  await chmod(binaryPath, 0o755);
  try {
    const result = await execWithStdin(binaryPath, [], {
      stdin,
      timeout: CODE_TIMEOUT_MS,
      env: sandboxedEnv(tempDir),
    });
    return { output: truncateOutput(result.stdout || ""), error: result.stderr || "", exitCode: 0 };
  } catch (err) {
    if (err.killed) return { output: "", error: "Execution timed out after 15 seconds.", exitCode: 124 };
    return {
      output: truncateOutput(err.stdout || ""),
      error: err.stderr || `Process exited with code ${err.code ?? 1}`,
      exitCode: err.code ?? 1,
    };
  }
}

function json(res, status, obj) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}

async function readBody(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  if (req.method !== "POST") {
    json(res, 404, { error: "not found" });
    return;
  }

  if (req.url === "/run") {
    const body = await readBody(req);
    if (body === null) return json(res, 400, { error: "invalid json" });

    const command = String(body.command || "").trim();
    const files = Array.isArray(body.files) ? body.files : [];
    const folders = Array.isArray(body.folders) ? body.folders : [];

    // No shell is involved (execFile), so pipes/redirects would be passed as
    // literal arguments and fail confusingly. Reject them with a clear message.
    if (/[|;&<>`]|\$\(/.test(command)) {
      return json(res, 403, { error: "Pipes, redirects and shell operators aren't supported here — run one command at a time." });
    }

    const argv = splitCommand(command);
    const full = argv[0] || "";
    const name = full.split("/").pop() || full;

    if (!name || !ALLOWED.has(name)) {
      return json(res, 403, { error: `Command "${name}" is not allowed.` });
    }

    const tempDir = await mkdtemp(join(tmpdir(), "sandbox-cmd-"));
    try {
      await writeProjectFiles(files, tempDir);
      for (const folder of folders) {
        if (typeof folder === "string") {
          const safe = sanitizePath(folder);
          if (safe) await mkdir(join(tempDir, safe), { recursive: true });
        }
      }
      try {
        const result = await execFileAsync(name, argv.slice(1), {
          cwd: tempDir,
          env: sandboxedEnv(tempDir),
          timeout: TIMEOUT_MS,
          maxBuffer: MAX_OUTPUT,
        });
        json(res, 200, { exitCode: 0, stdout: result.stdout.slice(0, MAX_OUTPUT), stderr: result.stderr.slice(0, MAX_OUTPUT) });
      } catch (err) {
        json(res, 200, {
          exitCode: typeof err.code === "number" ? err.code : 1,
          killed: Boolean(err.killed),
          stdout: (err.stdout || "").slice(0, MAX_OUTPUT),
          stderr: (err.stderr || "").slice(0, MAX_OUTPUT),
        });
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
    return;
  }

  if (req.url === "/code") {
    const body = await readBody(req);
    if (body === null) return json(res, 400, { error: "invalid json" });

    const language = body.language;
    const files = Array.isArray(body.files) ? body.files : [];
    const mainPath = body.mainPath || "";
    const stdin = typeof body.stdin === "string" ? body.stdin : "";

    if (language !== "python" && language !== "cpp") {
      return json(res, 400, { error: "Language must be 'python' or 'cpp'." });
    }
    if (!files.length) return json(res, 400, { error: "Provide at least one source file." });

    const tempDir = await mkdtemp(join(tmpdir(), "sandbox-code-"));
    try {
      await writeProjectFiles(files, tempDir);
      const main = findMainPath(files, mainPath);

      let result;
      if (language === "python") {
        result = await runPython(main, tempDir, stdin);
      } else {
        const sourceFiles = files
          .map((f) => sanitizeRelPath(f.path))
          .filter((p) => /\.(cpp|cc|cxx|c)$/i.test(p));
        const sources = sourceFiles.includes(main) ? sourceFiles : [main, ...sourceFiles];
        result = await runCpp(sources, tempDir, stdin);
      }
      json(res, 200, result);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
    return;
  }

  // Unit-test grading: pytest (Python) or doctest (C++). Writes the student's
  // files plus a hidden test file, then runs the test runner and returns its
  // exit code + output.
  if (req.url === "/test") {
    const body = await readBody(req);
    if (body === null) return json(res, 400, { error: "invalid json" });

    const mode = body.mode;
    const files = Array.isArray(body.files) ? body.files : [];
    const testFilePath = body.testFilePath || "";
    const testFileContent = body.testFileContent || "";

    if ((mode !== "pytest" && mode !== "doctest") || !testFilePath || !testFileContent) {
      return json(res, 400, { error: "mode, testFilePath and testFileContent are required." });
    }

    const tempDir = await mkdtemp(join(tmpdir(), "sandbox-test-"));
    try {
      await writeProjectFiles(files, tempDir);
      const safeTest = sanitizeRelPath(testFilePath);
      await writeFile(join(tempDir, safeTest), testFileContent, "utf8");

      let result;
      if (mode === "pytest") {
        try {
          const r = await execFileAsync("pytest", [safeTest, "-q", "--tb=short"], {
            cwd: tempDir,
            timeout: CODE_TIMEOUT_MS,
            maxBuffer: MAX_OUTPUT,
            env: sandboxedEnv(tempDir, { PYTHONDONTWRITEBYTECODE: "1" }),
          });
          result = { output: truncateOutput(r.stdout || ""), error: r.stderr || "", exitCode: 0 };
        } catch (err) {
          result = { output: truncateOutput(err.stdout || ""), error: err.stderr || err.stdout || "Tests failed.", exitCode: err.code ?? 1 };
        }
      } else {
        // doctest (C++): compile the test file (which includes the student's
        // solution) with doctest.h, then run the binary.
        const binaryPath = join(tempDir, "program");
        try {
          await execFileAsync("g++", ["-std=c++17", "-O2", "-I", "/doctest", "-o", binaryPath, safeTest], {
            cwd: tempDir,
            timeout: 30_000,
            maxBuffer: MAX_OUTPUT,
            env: sandboxedEnv(tempDir),
          });
        } catch (err) {
          result = { output: "", error: err.stderr || err.stdout || "Compilation failed.", exitCode: err.code ?? 1 };
        }
        if (!result) {
          await chmod(binaryPath, 0o755);
          try {
            const r = await execWithStdin(binaryPath, [], { timeout: CODE_TIMEOUT_MS, env: sandboxedEnv(tempDir) });
            result = { output: truncateOutput(r.stdout || ""), error: r.stderr || "", exitCode: 0 };
          } catch (err) {
            result = { output: truncateOutput(err.stdout || ""), error: err.stderr || `Tests failed (${err.code ?? 1}).`, exitCode: err.code ?? 1 };
          }
        }
      }
      json(res, 200, result);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
    return;
  }

  json(res, 404, { error: "not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`sandbox-runner listening on ${PORT}`);
});
