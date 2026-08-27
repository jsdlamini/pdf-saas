import { auth } from "@clerk/nextjs/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tier-1 terminal: an allowlisted single command, executed in a SEPARATE
// sandbox container with no app secrets and no route to the database or the
// internet. This route only does auth + rate limiting, then forwards to the
// sandbox runner (scripts/sandbox-runner.mjs) over the private sandbox network.
const SANDBOX_URL = process.env.SANDBOX_URL || "http://sandbox:3100";

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

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);
  if (!checkRateLimit(`run-command:${userId}`)) {
    return jsonError("Too many commands. Wait a minute and try again.", 429);
  }

  const body = (await request.json().catch(() => null)) as {
    command?: string;
    files?: Array<{ path: string; content: string }>;
    folders?: string[];
  } | null;
  const command = (body?.command || "").trim();
  if (!command) return jsonError("Enter a command.", 400);

  try {
    const res = await fetch(`${SANDBOX_URL}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command, files: body?.files ?? [], folders: body?.folders ?? [] }),
    });
    const data = (await res.json().catch(() => null)) as {
      exitCode?: number;
      killed?: boolean;
      stdout?: string;
      stderr?: string;
      error?: string;
    } | null;
    // Always return 200 so nginx never intercepts a 502/503 with its HTML
    // error page; errors ride in the JSON body instead.
    if (!data) {
      return Response.json({ error: "The sandbox is unavailable." });
    }
    return Response.json(data);
  } catch {
    return Response.json({ error: "The sandbox is unavailable right now. Try again shortly." });
  }
}
