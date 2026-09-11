import { auth } from "@clerk/nextjs/server";
import { getUserRole } from "@/lib/user-roles";
import { getGroupById } from "@/lib/groups";
import { listGroupMembers, listAllGroupMembers } from "@/lib/groups-store";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RosterRow = {
  group: string;
  name: string;
  surname: string;
  programme: string;
  studentId: string;
};

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Sign in required." }, { status: 401 });

  const role = await getUserRole(userId);
  if (role !== "admin") {
    return Response.json({ error: "Admin access required to download the roster." }, { status: 403 });
  }

  const url = new URL(request.url);
  const groupId = url.searchParams.get("group") || "";
  const all = groupId === "all";

  let title: string;
  let subtitle: string;
  let filename: string;
  let rows: RosterRow[];

  if (all) {
    const members = await listAllGroupMembers();
    rows = members.map((m) => ({
      group: m.groupName,
      name: m.name,
      surname: m.surname,
      programme: m.programme,
      studentId: m.studentId,
    }));
    const groupCount = new Set(rows.map((r) => r.group)).size;
    title = "Practical Groups — All Students";
    subtitle = `${rows.length} student${rows.length !== 1 ? "s" : ""} across ${groupCount} group${groupCount !== 1 ? "s" : ""}`;
    filename = "practical-groups-all-students.pdf";
  } else {
    const group = getGroupById(groupId);
    if (!group) return Response.json({ error: "Unknown group." }, { status: 404 });
    const members = await listGroupMembers(groupId);
    rows = members.map((m) => ({
      group: group.name,
      name: m.name,
      surname: m.surname,
      programme: m.programme,
      studentId: m.studentId,
    }));
    title = "Practical Group Roster";
    subtitle = `${group.name} — ${group.schedule} · ${rows.length} / ${group.capacity}`;
    filename = `${group.id}-roster.pdf`;
  }

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const pageW = 595;
  const pageH = 842;
  const margin = 48;
  const rowH = 21;
  const rowsPerPage = Math.floor((pageH - margin * 2 - 130) / rowH);

  // Column x-positions depend on whether we show the group column.
  const groupX = margin;
  const sidX = all ? margin + 78 : margin;
  const nameX = all ? margin + 168 : margin + 92;
  const surnameX = all ? margin + 292 : margin + 232;
  const progX = all ? margin + 408 : margin + 360;

  let page = pdf.addPage([pageW, pageH]);
  let y = pageH - margin;

  const newPage = () => {
    page = pdf.addPage([pageW, pageH]);
    y = pageH - margin;
  };

  const drawHeader = () => {
    page.drawText(title, { x: margin, y, size: 19, font: bold, color: rgb(0.1, 0.1, 0.16) });
    y -= 22;
    page.drawText(subtitle, { x: margin, y, size: 10, font, color: rgb(0.42, 0.45, 0.55) });
    y -= 24;
    if (all) page.drawText("Group", { x: groupX, y, size: 9, font: bold, color: rgb(0.5, 0.52, 0.6) });
    page.drawText("Student ID", { x: sidX, y, size: 9, font: bold, color: rgb(0.5, 0.52, 0.6) });
    page.drawText("Name", { x: nameX, y, size: 9, font: bold, color: rgb(0.5, 0.52, 0.6) });
    page.drawText("Surname", { x: surnameX, y, size: 9, font: bold, color: rgb(0.5, 0.52, 0.6) });
    page.drawText("Programme", { x: progX, y, size: 9, font: bold, color: rgb(0.5, 0.52, 0.6) });
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

  if (rows.length === 0) {
    page.drawText("No students have joined yet.", { x: margin, y, size: 10, font, color: rgb(0.45, 0.47, 0.55) });
  } else {
    let row = 0;
    rows.forEach((m, i) => {
      if (row >= rowsPerPage) {
        newPage();
        drawHeader();
        row = 0;
      }
      if (all) page.drawText(m.group, { x: groupX, y, size: 9, font, color: rgb(0.35, 0.37, 0.45) });
      page.drawText(`${i + 1}. ${m.studentId}`, { x: sidX, y, size: 9, font, color: rgb(0.15, 0.16, 0.22) });
      page.drawText(m.name, { x: nameX, y, size: 10, font, color: rgb(0.15, 0.16, 0.22) });
      page.drawText(m.surname, { x: surnameX, y, size: 10, font, color: rgb(0.15, 0.16, 0.22) });
      page.drawText(m.programme, { x: progX, y, size: 8, font, color: rgb(0.42, 0.45, 0.55) });
      y -= rowH;
      row += 1;
    });
  }

  const bytes = await pdf.save();
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
