import { auth } from "@clerk/nextjs/server";
import { createRateLimiter } from "@/lib/rate-limit";
import { proxyTerminal } from "@/lib/terminal-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const checkRateLimit = createRateLimiter(60_000, 300);

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

// Send one line of input to a running terminal session.
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);
  if (!checkRateLimit(`terminal-stdin:${userId}`)) return jsonError("Too many inputs.", 429);

  const body = (await request.json().catch(() => null)) as { sessionId?: string; data?: string } | null;
  if (!body?.sessionId) return jsonError("sessionId is required.", 400);

  return Response.json(await proxyTerminal("/term/stdin", { sessionId: body.sessionId, data: body.data ?? "" }));
}
