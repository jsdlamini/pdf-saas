import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { auth } from "@clerk/nextjs/server";
import { getUserRole } from "@/lib/user-roles";
import { getGroupById } from "@/lib/groups";
import { getRosterWithMarks } from "@/lib/assess-store";

const execFileAsync = promisify(execFile);

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
  const all = groupId === "all";

  let filename: string;
  if (all) {
    filename = "practical-groups-all-students.xlsx";
  } else {
    const group = getGroupById(groupId);
    if (!group) return Response.json({ error: "Unknown group." }, { status: 404 });
    filename = `${group.id}-roster.xlsx`;
  }

  const rows = await getRosterWithMarks(all ? null : groupId);
  const dir = await mkdtemp(join(tmpdir(), "roster-export-"));
  const jsonPath = join(dir, "data.json");
  const xlsxPath = join(dir, "roster.xlsx");

  try {
    await writeFile(jsonPath, JSON.stringify(rows), "utf8");
    await execFileAsync("python3", [join(process.cwd(), "scripts", "roster-export.py"), jsonPath, xlsxPath], {
      maxBuffer: 16 * 1024 * 1024,
    });
    const bytes = await readFile(xlsxPath);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("[roster-export] failed:", error);
    return Response.json({ error: "Could not build the spreadsheet." }, { status: 500 });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => { /* best-effort cleanup */ });
  }
}
