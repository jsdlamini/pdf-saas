// Liveness probe for the container healthcheck. Intentionally public and
// dependency-free: it only proves the app process can serve a response.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ ok: true });
}
