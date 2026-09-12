import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { auth } from "@clerk/nextjs/server";
import { getUserRole } from "@/lib/user-roles";
import { getGroupById } from "@/lib/groups";
import { getAssessment } from "@/lib/assess-store";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Sign in required." }, { status: 401 });

  const role = await getUserRole(userId);
  if (role !== "admin" && role !== "assistant") {
    return Response.json({ error: "Assessor access required." }, { status: 403 });
  }

  const url = new URL(request.url);
  const groupId = url.searchParams.get("group") || "";
  const group = getGroupById(groupId);
  if (!group) return Response.json({ error: "Unknown group." }, { status: 404 });

  const data = await getAssessment(groupId);
  const dir = await mkdtemp(join(tmpdir(), "assess-export-"));
  const jsonPath = join(dir, "data.json");
  const xlsxPath = join(dir, "marks.xlsx");

  try {
    await writeFile(jsonPath, JSON.stringify(data), "utf8");
    await execFileAsync("python3", [join(process.cwd(), "scripts", "assess-export.py"), jsonPath, xlsxPath], {
      maxBuffer: 16 * 1024 * 1024,
    });
    const bytes = await readFile(xlsxPath);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${group.id}-marks.xlsx"`,
      },
    });
  } catch (error) {
    console.error("[assess-export] failed:", error);
    return Response.json({ error: "Could not build the spreadsheet." }, { status: 500 });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => { /* best-effort cleanup */ });
  }
}
