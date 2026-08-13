import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { auth } from "@clerk/nextjs/server";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 30_000;

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonError("Sign in required.", 401);

  const body = await request.json().catch(() => null) as { code?: string } | null;
  const code = typeof body?.code === "string" ? body.code : "";
  if (!code.trim()) return jsonError("Provide Python code.", 400);

  const tempDir = await mkdtemp(join(tmpdir(), "wiserfiles-fig-"));
  const scriptPath = join(tempDir, "script.py");

  // Wrap the user's code so matplotlib renders headless and we capture every figure.
  const wrapper = `import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

# --- user code ---
${code}

# --- capture figures ---
figs = [plt.figure(n) for n in plt.get_fignums()]
if not figs:
    fig = plt.figure()
    fig.text(0.5, 0.5, "No figure was created", ha="center", va="center")
    fig.savefig("figure_0.png", dpi=150, bbox_inches="tight")
else:
    for i, fig in enumerate(figs):
        fig.savefig(f"figure_{i}.png", dpi=150, bbox_inches="tight")
`;

  await writeFile(scriptPath, wrapper, "utf8");

  try {
    await execFileAsync("python3", [scriptPath], {
      cwd: tempDir,
      timeout: TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...process.env,
        HOME: tempDir,
        TMPDIR: tempDir,
        MPLBACKEND: "Agg",
        PATH: process.env.PATH || "/usr/bin:/bin",
      },
    });

    const pngBytes = await readFile(join(tempDir, "figure_0.png"));
    return new Response(pngBytes, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Figure generation failed.";
    return jsonError(`Figure generation failed: ${message}`, 502);
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
