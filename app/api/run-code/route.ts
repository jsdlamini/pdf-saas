import { auth } from "@clerk/nextjs/server";
import { createRateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SANDBOX_URL = process.env.SANDBOX_URL || "http://sandbox:3100";

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 30;
const checkRateLimit = createRateLimiter(RATE_WINDOW_MS, RATE_MAX_REQUESTS);

type ProjectFile = { path: string; content: string };
type RunCodePayload = {
  language: "python" | "cpp";
  files: ProjectFile[];
  mainPath: string;
  stdin?: string;
};

const MAX_TOTAL_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_FILE_COUNT = 500;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

// Auth + validation stay here (policy). Execution runs in the isolated sandbox.
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);
  if (!checkRateLimit(`run-code:${userId}`)) return jsonError("Rate limit exceeded. Try again shortly.", 429);

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
  if (!files.length) return jsonError("Provide at least one source 'file'.", 400);
  if (files.length > MAX_FILE_COUNT) return jsonError(`Too many files (max ${MAX_FILE_COUNT}).`, 400);

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

  if (payload.language === "python") {
    const dangerousPatterns = [
      /\bos\.system\b/, /\bsubprocess\b/, /\bexec\b/, /\beval\b/, /\bcompile\b/,
      /\b__import__\b/, /\bopen\b/, /\bshutil\b/, /\bsocket\b/, /\brequests\b/,
    ];
    for (const pattern of dangerousPatterns) {
      if (pattern.test(allCode)) return jsonError("Code contains restricted operations.", 403);
    }
  }

  if (payload.language === "cpp") {
    const blockedIncludes = [
      /#include\s*[<"]filesystem[>"]/, /#include\s*[<"]fstream[>"]/,
      /#include\s*[<"]cstdio[>"]/, /#include\s*[<"]unistd\.h[>"]/, /#include\s*[<"]fcntl\.h[>"]/,
    ];
    for (const pattern of blockedIncludes) {
      if (pattern.test(allCode)) return jsonError("Code contains restricted includes.", 403);
    }
  }

  try {
    const res = await fetch(`${SANDBOX_URL}/code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: payload.language, files, mainPath: payload.mainPath || files[0].path, stdin: payload.stdin || "" }),
    });
    const data = (await res.json().catch(() => null)) as { output?: string; error?: string; exitCode?: number } | null;
    if (!res.ok || !data) {
      return jsonError(data?.error || "The sandbox is unavailable.", 502);
    }
    return Response.json(data);
  } catch {
    return jsonError("The sandbox is unavailable right now. Try again shortly.", 503);
  }
}
