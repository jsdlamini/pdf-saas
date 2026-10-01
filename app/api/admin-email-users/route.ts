import { requireDashboardAccess } from "@/lib/dashboard-access";
import { db } from "@/lib/db";
import { clerkClient } from "@clerk/nextjs/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://pdf.idealsoftwaresolutions.com";
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "WiserFiles <invites@idealsoftwaresolutions.com>";
const STUDIO_URL = `${APP_URL}/research-studio`;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

type LatexUser = {
  user_id: string;
  name: string;
  email: string;
  succeeded: number;
  failed: number;
  projects: number;
};

async function resolveLatexUsers(): Promise<LatexUser[]> {
  const rows = (
    await db.query(
      `SELECT
         user_id,
         COUNT(*) FILTER (WHERE event = 'compile' AND detail = 'latex')::int AS succeeded,
         COUNT(*) FILTER (WHERE event = 'compile-failed' AND detail = 'latex')::int AS failed
       FROM wiserfiles_analytics
       WHERE user_id IS NOT NULL AND user_id != 'guest'
         AND ((event IN ('compile', 'compile-failed') AND detail = 'latex') OR (event = 'pageview' AND tool = 'research-studio'))
       GROUP BY user_id
       ORDER BY succeeded ASC, failed DESC`
    )
  ).rows;

  const projRows = (
    await db.query(`SELECT user_id, COUNT(*)::int AS projects FROM wiserfiles_research_projects GROUP BY user_id`)
  ).rows;
  const projByUser = new Map<string, number>();
  for (const r of projRows) projByUser.set(r.user_id as string, r.projects as number);

  const ids = rows.map((r) => r.user_id as string);
  const info = new Map<string, { name: string; email: string }>();
  if (ids.length) {
    try {
      const client = await clerkClient();
      const settled = await Promise.allSettled(ids.map((id) => client.users.getUser(id)));
      settled.forEach((res, i) => {
        if (res.status !== "fulfilled") return;
        const u = res.value;
        const id = ids[i];
        const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.username || "";
        const email = u.primaryEmailAddress?.emailAddress || "";
        info.set(id, { name, email });
      });
    } catch {
      /* best-effort */
    }
  }

  return rows.map((r) => {
    const id = r.user_id as string;
    return {
      user_id: id,
      name: info.get(id)?.name ?? "",
      email: info.get(id)?.email ?? "",
      succeeded: r.succeeded as number,
      failed: r.failed as number,
      projects: projByUser.get(id) ?? 0,
    };
  });
}

async function sendEmail(to: string, subject: string, html: string) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, detail: "RESEND_API_KEY is not configured." };
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html }),
    });
    if (!response.ok) {
      const detail = await response.text();
      return { ok: false, detail: `Resend ${response.status}: ${detail.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : "Email send failed." };
  }
}

function shell(title: string, bodyHtml: string, ctaLabel: string): string {
  return `
  <div style="margin:0; padding:24px; background:#f1f5f9; font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; color:#0f172a;">
    <div style="max-width:600px; margin:0 auto; background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 10px 40px rgba(15,23,42,.10);">
      <div style="background:linear-gradient(120deg,#10b981 0%,#0ea5e9 100%); padding:26px 32px;">
        <div style="font-size:12px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:rgba(255,255,255,.85);">Research Studio</div>
        ${title ? `<div style="font-size:21px; font-weight:800; color:#ffffff; margin-top:4px; line-height:1.3;">${title}</div>` : ""}
      </div>
      <div style="padding:28px 32px; font-size:15px; line-height:1.65;">
        ${bodyHtml}
        <div style="text-align:center; margin:28px 0 8px;">
          <a href="${STUDIO_URL}" style="display:inline-block; background:#10b981; color:#ffffff; padding:13px 28px; border-radius:10px; font-weight:700; text-decoration:none; box-shadow:0 4px 16px rgba(16,185,129,.35);">${ctaLabel}</a>
        </div>
      </div>
      <div style="padding:18px 32px; background:#f8fafc; border-top:1px solid #e2e8f0; color:#94a3b8; font-size:12px;">
        Research Studio &middot; pdf.idealsoftwaresolutions.com
      </div>
    </div>
  </div>`;
}

function encouragementHtml(name: string): string {
  const body = `<p style="margin:0 0 16px;">Hi ${name},</p>
    <p style="margin:0 0 16px;">We noticed you set up a research project but it hasn't compiled yet. We've just fixed several issues with the LaTeX compiler, so it should work now.</p>
    <p style="margin:0 0 4px;">Click the button below to return to the Research Studio and try again.</p>
    <p style="margin:0; color:#64748b; font-size:13px;">If anything still fails, the error message will now tell you exactly what to fix.</p>`;
  return shell("Your project is ready to compile", body, "Open Research Studio");
}

function customHtml(body: string): string {
  const withLinks = body.replace(
    /(?<!href=")(?<!>)(https?:\/\/[^\s<>]+)/g,
    '<a href="$1" style="color:#0ea5e9;font-weight:600;">$1</a>'
  );
  const paragraphs = withLinks
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
  return shell("", paragraphs, "Open Research Studio");
}


export async function GET() {
  const access = await requireDashboardAccess();
  if (access.error) return jsonError(access.error, access.status);
  const users = await resolveLatexUsers();
  const reachable = users.filter((u) => u.email).length;
  return Response.json({ users, reachable });
}

export async function POST(request: Request) {
  const access = await requireDashboardAccess();
  if (access.error) return jsonError(access.error, access.status);

  const body = (await request.json().catch(() => null)) as {
    mode?: "encouragement" | "custom";
    subject?: string;
    body?: string;
    onlyZeroCompiles?: boolean;
    userId?: string;
  } | null;
  if (!body || !body.mode) return jsonError("mode is required.", 400);

  const users = await resolveLatexUsers();
  let targets = users.filter((u) => u.email);
  console.error('[admin-email-users] POST', JSON.stringify({
    mode: body.mode, userId: body.userId ?? null, withEmail: targets.length,
    subjectLen: (body.subject || '').length, bodyLen: (body.body || '').length,
  }));
  if (body.userId) {
    targets = targets.filter((u) => u.user_id === body.userId);
  } else if (body.onlyZeroCompiles !== false) {
    targets = targets.filter((u) => u.succeeded === 0);
  }
  if (!targets.length) return jsonError("No reachable users matched.", 400);

  const subject =
    body.mode === "encouragement"
      ? "Your research project is ready to compile"
      : (body.subject || "").trim();
  if (body.mode === "custom" && !subject) return jsonError("Subject is required.", 400);
  if (body.mode === "custom" && !(body.body || "").trim()) return jsonError("Message body is required.", 400);

  const results: Array<{ email: string; name: string; ok: boolean }> = [];
  for (const u of targets) {
    const html =
      body.mode === "encouragement" ? encouragementHtml(u.name || "there") : customHtml(body.body || "");
    const r = await sendEmail(u.email, subject, html);
    results.push({ email: u.email, name: u.name, ok: r.ok });
  }

  return Response.json({
    sent: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
}
