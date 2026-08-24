import { requireDashboardAccess } from "@/lib/dashboard-access";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SNIPPET_FILES: Record<string, string> = {
  reddit: "reddit-posts.md",
  tiktok: "tiktok-scripts.md",
  producthunt: "producthunt-launch.md",
  twitter: "marketing-assets.md",
};

const ROTATING_TWEETS = [
  "PDF → Excel that gives you actual cells, not a text dump. WiserFiles detects the real tables and writes each one to its own sheet. Free: https://pdf.idealsoftwaresolutions.com/tools/pdf-to-excel",
  "PDF → PowerPoint with real slides — title, bullets, and images per page, not one text blob. Free, in your browser: https://pdf.idealsoftwaresolutions.com/tools/pdf-to-powerpoint",
  "PDF → Word that keeps its headings, lists, and tables. No more flattening to plain text. Free: https://pdf.idealsoftwaresolutions.com/tools/pdf-to-word",
  "Real redaction deletes the text — it doesn't just draw a box over it. Permanent, unrecoverable. Free: https://pdf.idealsoftwaresolutions.com/tools/redact-pdf",
  "Write LaTeX, Python, or C++ with a live PDF beside your code. Instant incremental compile — your PDF updates in a fraction of a second. https://pdf.idealsoftwaresolutions.com/research-studio",
  "25 free PDF tools. 20 run fully offline in your browser — merge, split, compress, sign, redact. Nothing uploaded, nothing stored. https://pdf.idealsoftwaresolutions.com",
  "Need to OCR a scanned PDF? WiserFiles does it in your browser — no upload stored, no account required. Free, private, instant. https://pdf.idealsoftwaresolutions.com/tools/ocr-pdf",
  "Students: stop paying for PDF tools. WiserFiles has 25 tools — all free, all private. Files encrypted and auto-deleted. https://pdf.idealsoftwaresolutions.com",
  "Research students: a full LaTeX + Python + C++ editor with AI peer review, live collaboration, and computed figures. Free. https://pdf.idealsoftwaresolutions.com/research-studio",
  "Write a paper with AI help: summarize, rewrite, expand, improve grammar, even get a simulated peer review before you submit. https://pdf.idealsoftwaresolutions.com/research-studio",
  "Import your whole LaTeX or Overleaf project as a zip — chapters, figures, and appendices restored in one click. https://pdf.idealsoftwaresolutions.com/research-studio",
  "Compare PDFs side by side — visual diff with color-coded changes. Free, in your browser. https://pdf.idealsoftwaresolutions.com/tools/compare-pdf",
  "Sign PDFs electronically. Draw or type your signature. No account, no upload stored. Free. https://pdf.idealsoftwaresolutions.com/tools/sign-pdf",
  "Compress PDFs without destroying quality. Your file never leaves your computer. https://pdf.idealsoftwaresolutions.com/tools/compress-pdf",
  "Collaborate on papers in real time: live cursors, live edits, and version history with visual diffs — in a free LaTeX editor. https://pdf.idealsoftwaresolutions.com/research-studio",
  "Generate publication-ready figures straight from Python code, then embed them in your LaTeX paper. Reproducible research, one workspace. https://pdf.idealsoftwaresolutions.com/research-studio",
  "No internet? No problem. 20 of WiserFiles' 25 tools run fully offline in your browser. Install once, keep working anywhere. https://pdf.idealsoftwaresolutions.com",
];

const MARKETING_DIR = path.join(process.cwd(), "public", "marketing");

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

async function checkAccess() {
  const access = await requireDashboardAccess();
  if (access.error) {
    throw new Error(access.status === 401 ? "signin" : "denied");
  }
}

export async function GET(request: Request) {
  try {
    await checkAccess();
  } catch (e) {
    if (e instanceof Error && e.message === "signin") return jsonError("Sign in required.", 401);
    return jsonError("Access denied.", 403);
  }

  const url = new URL(request.url);
  const platform = url.searchParams.get("platform") || "";
  const rotate = url.searchParams.get("rotate") === "1";

  if (platform === "twitter" || platform === "linkedin") {
    const index = rotate ? Math.floor(Math.random() * ROTATING_TWEETS.length) : 0;
    const tweets = rotate
      ? [ROTATING_TWEETS[index], ROTATING_TWEETS[(index + 1) % ROTATING_TWEETS.length]]
      : ROTATING_TWEETS.slice(0, 4);
    return Response.json({
      platform,
      type: "snippets",
      snippets: tweets.map((t, i) => ({ id: i, text: t })),
      regenerated: rotate,
    });
  }

  if (platform === "tiktok") {
    const captions = [
      "PDF → Excel that gives you real cells, not a text dump. Tables detected, one per sheet. 📊🔒 #excel #pdftools #data #freetools",
      "PDF → PowerPoint with real slides — title, bullets, images. Not a text blob. 📊 #powerpoint #pdftools #productivity",
      "PDF → Word that keeps headings, lists, and tables. Structure preserved. 📄 #word #pdftools #students",
      "Real redaction deletes the text — it doesn't just cover it. Permanent. 🔒 #privacy #security #pdftools",
      "Write LaTeX, Python, or C++ with a live PDF beside your code. Instant compile. 🧠📄 #latex #python #phdlife #academia",
      "20 PDF tools that work fully offline — nothing uploaded, nothing stored. 📴 #offline #pdftools #privacy #freetools",
    ];
    return Response.json({
      platform: "tiktok",
      type: "snippets",
      snippets: captions.map((c, i) => ({ id: i, text: c })),
      regenerated: false,
    });
  }

  const file = SNIPPET_FILES[platform];
  if (!file) {
    return Response.json({
      platforms: Object.keys(SNIPPET_FILES),
      social: ["twitter", "linkedin", "tiktok"],
      usage: "?platform=twitter&rotate=1",
    });
  }

  const content = fs.readFileSync(path.join(MARKETING_DIR, file), "utf8");
  return Response.json({ platform, type: "markdown", content });
}
