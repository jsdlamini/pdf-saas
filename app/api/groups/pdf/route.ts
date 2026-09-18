import { auth } from "@clerk/nextjs/server";
import { getUserRole } from "@/lib/user-roles";
import { getGroupById } from "@/lib/groups";
import { getRosterWithMarks } from "@/lib/assess-store";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fmt = (score: number | null, max: number) => (score == null ? "—" : `${score}/${max}`);

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

  if (all) {
    const rows = await getRosterWithMarks(null);
    const groupCount = new Set(rows.map((r) => r.group)).size;
    title = "Practical Groups — All Students with Marks";
    subtitle = `${rows.length} student${rows.length !== 1 ? "s" : ""} across ${groupCount} group${groupCount !== 1 ? "s" : ""}`;
    filename = "practical-groups-all-students.pdf";
    return buildPdf(title, subtitle, filename, rows, true);
  } else {
    const group = getGroupById(groupId);
    if (!group) return Response.json({ error: "Unknown group." }, { status: 404 });
    const rows = await getRosterWithMarks(groupId);
    title = "Practical Group Roster with Marks";
    subtitle = `${group.name} — ${group.schedule} · ${rows.length} / ${group.capacity}`;
    filename = `${group.id}-roster.pdf`;
    return buildPdf(title, subtitle, filename, rows, false);
  }
}

async function buildPdf(
  title: string,
  subtitle: string,
  filename: string,
  rows: Awaited<ReturnType<typeof getRosterWithMarks>>,
  showGroup: boolean
) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // Landscape so the three mark columns fit alongside the roster.
  const pageW = 842;
  const pageH = 595;
  const margin = 40;
  const rowH = 19;
  const rowsPerPage = Math.floor((pageH - margin * 2 - 120) / rowH);

  const groupX = margin;
  const sidX = showGroup ? margin + 80 : margin;
  const nameX = showGroup ? margin + 165 : margin + 90;
  const surnameX = showGroup ? margin + 275 : margin + 200;
  const progX = showGroup ? margin + 385 : margin + 310;
  const pX = showGroup ? margin + 500 : margin + 425;
  const tX = showGroup ? margin + 570 : margin + 495;
  const eX = showGroup ? margin + 640 : margin + 565;

  let page = pdf.addPage([pageW, pageH]);
  let y = pageH - margin;

  const newPage = () => {
    page = pdf.addPage([pageW, pageH]);
    y = pageH - margin;
  };

  const drawHeader = () => {
    page.drawText(title, { x: margin, y, size: 18, font: bold, color: rgb(0.1, 0.1, 0.16) });
    y -= 20;
    page.drawText(subtitle, { x: margin, y, size: 9, font, color: rgb(0.42, 0.45, 0.55) });
    y -= 22;
    if (showGroup) page.drawText("Group", { x: groupX, y, size: 8, font: bold, color: rgb(0.5, 0.52, 0.6) });
    page.drawText("Student ID", { x: sidX, y, size: 8, font: bold, color: rgb(0.5, 0.52, 0.6) });
    page.drawText("Name", { x: nameX, y, size: 8, font: bold, color: rgb(0.5, 0.52, 0.6) });
    page.drawText("Surname", { x: surnameX, y, size: 8, font: bold, color: rgb(0.5, 0.52, 0.6) });
    page.drawText("Programme", { x: progX, y, size: 8, font: bold, color: rgb(0.5, 0.52, 0.6) });
    page.drawText("Practical", { x: pX, y, size: 8, font: bold, color: rgb(0.5, 0.52, 0.6) });
    page.drawText("Test", { x: tX, y, size: 8, font: bold, color: rgb(0.5, 0.52, 0.6) });
    page.drawText("Exam", { x: eX, y, size: 8, font: bold, color: rgb(0.5, 0.52, 0.6) });
    y -= 8;
    page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 1, color: rgb(0.85, 0.86, 0.9) });
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
      if (showGroup) page.drawText(m.group, { x: groupX, y, size: 8, font, color: rgb(0.35, 0.37, 0.45) });
      page.drawText(`${i + 1}. ${m.studentId}`, { x: sidX, y, size: 8, font, color: rgb(0.15, 0.16, 0.22) });
      page.drawText(m.name, { x: nameX, y, size: 9, font, color: rgb(0.15, 0.16, 0.22) });
      page.drawText(m.surname, { x: surnameX, y, size: 9, font, color: rgb(0.15, 0.16, 0.22) });
      page.drawText(m.programme, { x: progX, y, size: 7.5, font, color: rgb(0.42, 0.45, 0.55) });
      page.drawText(fmt(m.practical.score, m.practical.max), { x: pX, y, size: 8, font, color: rgb(0.15, 0.16, 0.22) });
      page.drawText(fmt(m.test.score, m.test.max), { x: tX, y, size: 8, font, color: rgb(0.15, 0.16, 0.22) });
      page.drawText(fmt(m.exam.score, m.exam.max), { x: eX, y, size: 8, font, color: rgb(0.15, 0.16, 0.22) });
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
