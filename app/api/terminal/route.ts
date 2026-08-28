import { auth } from "@clerk/nextjs/server";
import { createRateLimiter } from "@/lib/rate-limit";
import { proxyTerminal } from "@/lib/terminal-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const checkRateLimit = createRateLimiter(60_000, 30);

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

// Start an interactive terminal session (allowlisted command, open stdin).
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);
  if (!checkRateLimit(`terminal:${userId}`)) return jsonError("Too many commands. Wait a minute and try again.", 429);

  const body = (await request.json().catch(() => null)) as {
    command?: string;
    files?: Array<{ path: string; content: string }>;
    folders?: string[];
  } | null;
  if (!body?.command?.trim()) return jsonError("Enter a command.", 400);

  return Response.json(await proxyTerminal("/term", { command: body.command.trim(), files: body.files ?? [], folders: body.folders ?? [] }));
}
