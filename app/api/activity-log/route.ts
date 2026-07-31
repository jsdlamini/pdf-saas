import { listRecentActivity, recordActivity, type ActivityLogEntry } from "@/lib/activity-log-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const entries = await listRecentActivity(30);
    return Response.json({ entries });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load activity log.";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let payload: Partial<ActivityLogEntry>;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  if (!payload.toolSlug) {
    return Response.json({ error: "toolSlug is required." }, { status: 400 });
  }

  try {
    const entry = await recordActivity({
      toolSlug: payload.toolSlug,
      toolName: payload.toolName,
      fileName: payload.fileName,
      fileSize: payload.fileSize,
      durationMs: payload.durationMs,
      success: payload.success !== false,
    });
    return Response.json({ entry }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not record activity.";
    return Response.json({ error: message }, { status: 500 });
  }
}
