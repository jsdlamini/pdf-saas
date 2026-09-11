import { auth, clerkClient } from "@clerk/nextjs/server";
import { getUserRole } from "@/lib/user-roles";
import { getGroupById } from "@/lib/groups";
import { listGroupMemberIds } from "@/lib/groups-store";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Sign in required." }, { status: 401 });

  const role = await getUserRole(userId);
  if (role !== "admin") {
    return Response.json({ error: "Admin access required to download the roster." }, { status: 403 });
  }

  const url = new URL(request.url);
  const groupId = url.searchParams.get("group") || "";
  const group = getGroupById(groupId);
  if (!group) return Response.json({ error: "Unknown group." }, { status: 404 });

  const memberIds = await listGroupMemberIds(groupId);
  const client = await clerkClient();
  const members: { name: string; email: string }[] = [];
  for (const id of memberIds) {
    try {
      const u = await client.users.getUser(id);
      const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.username || "—";
      members.push({ name, email: u.primaryEmailAddress?.emailAddress || "" });
    } catch {
      members.push({ name: "—", email: "" });
    }
  }

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const pageW = 595;
  const pageH = 842;
  const margin = 56;
  const rowH = 21;
  const rowsPerPage = Math.floor((pageH - margin * 2 - 130) / rowH);

  let page = pdf.addPage([pageW, pageH]);
  let y = pageH - margin;

  const newPage = () => {
    page = pdf.addPage([pageW, pageH]);
    y = pageH - margin;
  };

  const drawHeader = () => {
    page.drawText("Study Group Roster", { x: margin, y, size: 20, font: bold, color: rgb(0.1, 0.1, 0.16) });
    y -= 24;
    page.drawText(`${group.name} — ${group.schedule}`, { x: margin, y, size: 12, font: bold, color: rgb(0.25, 0.28, 0.4) });
    y -= 18;
    page.drawText(`Enrolled: ${members.length} / ${group.capacity}`, { x: margin, y, size: 10, font, color: rgb(0.42, 0.45, 0.55) });
    y -= 26;
    page.drawText("Name", { x: margin, y, size: 9, font: bold, color: rgb(0.5, 0.52, 0.6) });
    page.drawText("Email", { x: margin + 240, y, size: 9, font: bold, color: rgb(0.5, 0.52, 0.6) });
    y -= 8;
    page.drawLine({
      start: { x: margin, y },
      end: { x: pageW - margin, y },
      thickness: 1,
      color: rgb(0.85, 0.86, 0.9),
    });
    y -= rowH;
  };

  drawHeader();

  if (members.length === 0) {
    page.drawText("No students have joined this group yet.", { x: margin, y, size: 10, font, color: rgb(0.45, 0.47, 0.55) });
  } else {
    let row = 0;
    members.forEach((m, i) => {
      if (row >= rowsPerPage) {
        newPage();
        drawHeader();
        row = 0;
      }
      page.drawText(`${i + 1}. ${m.name}`, { x: margin, y, size: 10, font, color: rgb(0.15, 0.16, 0.22) });
      page.drawText(m.email, { x: margin + 240, y, size: 9, font, color: rgb(0.42, 0.45, 0.55) });
      y -= rowH;
      row += 1;
    });
  }

  const bytes = await pdf.save();
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${group.id}-roster.pdf"`,
    },
  });
}
