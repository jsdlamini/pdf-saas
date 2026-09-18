import { auth } from "@clerk/nextjs/server";
import { getUserRole } from "@/lib/user-roles";
import { getGroupById } from "@/lib/groups";
import { getRosterWithMarks, type RosterColumn, type RosterMarkRow } from "@/lib/assess-store";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fmt = (score: number | null) => (score == null ? "—" : String(score));

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
  let data: { columns: RosterColumn[]; rows: RosterMarkRow[] };
  let showGroup: boolean;

  if (all) {
    data = await getRosterWithMarks(null);
    const groupCount = new Set(data.rows.map((r) => r.group)).size;
    title = "Practical Groups — All Students with Marks";
    subtitle = `${data.rows.length} student${data.rows.length !== 1 ? "s" : ""} across ${groupCount} group${groupCount !== 1 ? "s" : ""}`;
    filename = "practical-groups-all-students.pdf";
    showGroup = true;
  } else {
    const group = getGroupById(groupId);
    if (!group) return Response.json({ error: "Unknown group." }, { status: 404 });
    data = await getRosterWithMarks(groupId);
    title = "Practical Group Roster with Marks";
    subtitle = `${group.name} — ${group.schedule} · ${data.rows.length} / ${group.capacity}`;
    filename = `${group.id}-roster.pdf`;
    showGroup = false;
  }

  return buildPdf(title, subtitle, filename, data, showGroup);
}

function shortLabel(c: RosterColumn): string {
  return c.kind === "practical" ? `P${c.order}` : c.kind === "test" ? `T${c.order}` : `E${c.order}`;
}

async function buildPdf(
  title: string,
  subtitle: string,
  filename: string,
  data: { columns: RosterColumn[]; rows: RosterMarkRow[] },
  showGroup: boolean
) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const pageW = 842;
  const pageH = 595;
  const margin = 40;
  const rowH = 18;
  const rowsPerPage = Math.floor((pageH - margin * 2 - 130) / rowH);

  const groupX = margin;
  const sidX = showGroup ? margin + 85 : margin;
  const nameX = showGroup ? margin + 175 : margin + 95;
  const surnameX = showGroup ? margin + 290 : margin + 210;
  const progX = showGroup ? margin + 405 : margin + 325;

  const itemStartX = showGroup ? margin + 525 : margin + 440;
  const availableW = pageW - margin - itemStartX;
  const itemW = data.columns.length
    ? Math.max(30, Math.min(60, availableW / data.columns.length))
    : 60;

  let page = pdf.addPage([pageW, pageH]);
  let y = pageH - margin;

  const newPage = () => {
    page = pdf.addPage([pageW, pageH]);
    y = pageH - margin;
  };

  const drawHeader = () => {
    page.drawText(title, { x: margin, y, size: 16, font: bold, color: rgb(0.1, 0.1, 0.16) });
    y -= 18;
    page.drawText(`${subtitle} · P = Practical, T = Test, E = Exam`, { x: margin, y, size: 8.5, font, color: rgb(0.42, 0.45, 0.55) });
    y -= 20;
    if (showGroup) page.drawText("Group", { x: groupX, y, size: 8, font: bold, color: rgb(0.5, 0.52, 0.6) });
    page.drawText("Student ID", { x: sidX, y, size: 8, font: bold, color: rgb(0.5, 0.52, 0.6) });
    page.drawText("Name", { x: nameX, y, size: 8, font: bold, color: rgb(0.5, 0.52, 0.6) });
    page.drawText("Surname", { x: surnameX, y, size: 8, font: bold, color: rgb(0.5, 0.52, 0.6) });
    page.drawText("Programme", { x: progX, y, size: 8, font: bold, color: rgb(0.5, 0.52, 0.6) });
    data.columns.forEach((c, i) => {
      const x = itemStartX + i * itemW;
      page.drawText(shortLabel(c), { x, y, size: 8, font: bold, color: rgb(0.5, 0.52, 0.6) });
    });
    y -= 8;
    page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 1, color: rgb(0.85, 0.86, 0.9) });
    y -= rowH;
  };

  drawHeader();

  if (data.rows.length === 0) {
    page.drawText("No students have joined yet.", { x: margin, y, size: 10, font, color: rgb(0.45, 0.47, 0.55) });
  } else {
    let row = 0;
    data.rows.forEach((m, i) => {
      if (row >= rowsPerPage) {
        newPage();
        drawHeader();
        row = 0;
      }
      if (showGroup) page.drawText(m.group, { x: groupX, y, size: 7.5, font, color: rgb(0.35, 0.37, 0.45) });
      page.drawText(`${i + 1}. ${m.studentId}`, { x: sidX, y, size: 8, font, color: rgb(0.15, 0.16, 0.22) });
      page.drawText(m.name, { x: nameX, y, size: 8.5, font, color: rgb(0.15, 0.16, 0.22) });
      page.drawText(m.surname, { x: surnameX, y, size: 8.5, font, color: rgb(0.15, 0.16, 0.22) });
      page.drawText(m.programme, { x: progX, y, size: 7, font, color: rgb(0.42, 0.45, 0.55) });
      data.columns.forEach((c, ci) => {
        const x = itemStartX + ci * itemW;
        const score = m.scores[ci];
        page.drawText(fmt(score), { x, y, size: 8, font, color: rgb(0.15, 0.16, 0.22) });
      });
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
