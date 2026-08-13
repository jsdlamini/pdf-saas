import { auth } from "@clerk/nextjs/server";
import { Pool } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

async function sendInviteEmail(to: string, projectName: string, accessLevel: string, inviterName: string, shareId: string) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, detail: "RESEND_API_KEY is not configured." };
  }

  const fromEmail = process.env.RESEND_FROM_EMAIL || "WiserFiles <invites@idealsoftwaresolutions.com>";
  const appUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || "https://pdf.idealsoftwaresolutions.com";
  const accessLabel = accessLevel === "admin" ? "Admin (full access)" : accessLevel === "write" ? "Write (can edit)" : "Read-only";
  const projectUrl = shareId
    ? `${appUrl}/research-studio?share=${encodeURIComponent(shareId)}`
    : `${appUrl}/research-studio`;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [to],
        subject: `${inviterName} invited you to collaborate on "${projectName}"`,
        html: `
          <div style="font-family: Inter, -apple-system, sans-serif; color: #0f172a; line-height: 1.6">
            <h2 style="margin: 0 0 12px">You've been invited to collaborate</h2>
            <p><strong>${inviterName}</strong> invited you to <strong>${projectName}</strong> with <strong>${accessLabel}</strong> access.</p>
            <p>Click below to open the project:</p>
            <p style="margin: 20px 0">
              <a href="${projectUrl}" style="background:#4ade80;color:#0f172a;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600">Open ${projectName}</a>
            </p>
            <p style="color:#64748b;font-size:13px">Sign in with <strong>${to}</strong> to access the shared project.</p>
          </div>
        `,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      return { ok: false, detail: `Resend ${response.status}: ${detail.slice(0, 500)}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : "Email send failed." };
  }
}

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  if (!projectId) return jsonError("Missing projectId", 400);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS wiserfiles_project_invites (
      id SERIAL PRIMARY KEY,
      project_id TEXT NOT NULL,
      project_name TEXT NOT NULL DEFAULT '',
      invited_by TEXT NOT NULL,
      shared_with_email TEXT NOT NULL,
      access_level TEXT NOT NULL DEFAULT 'read',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const result = await pool.query(
    `SELECT * FROM wiserfiles_project_invites WHERE project_id = $1 ORDER BY created_at DESC`,
    [projectId]
  );
  await pool.end();
  return Response.json({ invites: result.rows });
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const body = await request.json();
  const { projectId, projectName, email, accessLevel, shareId } = body as {
    projectId?: string; projectName?: string; email?: string; accessLevel?: string; shareId?: string;
  };

  if (!projectId || !email || !accessLevel) return jsonError("Missing fields", 400);
  if (!["read", "write", "admin"].includes(accessLevel)) return jsonError("Invalid access level", 400);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS wiserfiles_project_invites (
      id SERIAL PRIMARY KEY,
      project_id TEXT NOT NULL,
      project_name TEXT NOT NULL DEFAULT '',
      invited_by TEXT NOT NULL,
      shared_with_email TEXT NOT NULL,
      access_level TEXT NOT NULL DEFAULT 'read',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const result = await pool.query(
    `INSERT INTO wiserfiles_project_invites (project_id, project_name, invited_by, shared_with_email, access_level)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING *`,
    [projectId, projectName || "", userId, email.toLowerCase().trim(), accessLevel]
  );
  await pool.end();

  // Send the invitation email via Resend (best-effort; invite is still stored on failure)
  const inviterName = "A collaborator";
  const emailResult = await sendInviteEmail(email.trim(), projectName || "Untitled project", accessLevel, inviterName, shareId || "");

  return Response.json({
    invite: result.rows[0],
    emailSent: emailResult.ok,
    emailError: emailResult.ok ? undefined : emailResult.detail,
  });
}

export async function DELETE(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const url = new URL(request.url);
  const inviteId = url.searchParams.get("id");
  if (!inviteId) return jsonError("Missing invite id", 400);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  await pool.query(`DELETE FROM wiserfiles_project_invites WHERE id = $1 AND invited_by = $2`, [inviteId, userId]);
  await pool.end();
  return Response.json({ ok: true });
}
