import { Pool } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-Sent Events stream for real-time collaboration updates.
// Uses PostgreSQL LISTEN/NOTIFY so every connected collaborator is pushed
// the moment someone else saves a change (no polling delay).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  if (!projectId || !/^[a-zA-Z0-9_-]{1,100}$/.test(projectId)) {
    return Response.json({ error: "Missing or invalid projectId" }, { status: 400 });
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  const channel = `collab_${projectId}`;
  await client.query(`LISTEN ${channel}`);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(": ping\n\n")); } catch { /* closed */ }
      }, 15000);

      const onNotification = (msg: { payload?: string }) => {
        try {
          const payload = msg.payload || "{}";
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        } catch { /* closed */ }
      };

      client.on("notification", onNotification);

      const cleanup = () => {
        clearInterval(heartbeat);
        client.removeListener("notification", onNotification);
        client.release();
        void pool.end();
      };

      request.signal.addEventListener("abort", cleanup);
      // Also clean up if the client disconnects (stream cancel)
      controller.close = () => {
        cleanup();
        (controller as { close: () => void }).close();
      };
    },
    cancel() {
      client.release();
      void pool.end();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
