import { auth } from "@clerk/nextjs/server";
import { createRateLimiter } from "@/lib/rate-limit";
import { proxyTerminal } from "@/lib/terminal-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const checkRateLimit = createRateLimiter(60_000, 60);

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

// Re-sync the latest project files into a running terminal session's working
// directory, so "Run" uses the current editor contents.
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);
  if (!checkRateLimit(`terminal-files:${userId}`)) return jsonError("Too many requests.", 429);

  const body = (await request.json().catch(() => null)) as {
    sessionId?: string;
    files?: Array<{ path: string; content: string }>;
    folders?: string[];
  } | null;
  if (!body?.sessionId) return jsonError("sessionId is required.", 400);

  return Response.json(await proxyTerminal("/term/files", { sessionId: body.sessionId, files: body.files ?? [], folders: body.folders ?? [] }));
}
