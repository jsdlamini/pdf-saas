import { auth, clerkClient } from "@clerk/nextjs/server";
import { DASHBOARD_ALLOWED } from "@/lib/dashboard-access";
import { getUserRole, ensureUserRecord } from "@/lib/user-roles";
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
  "30 free PDF tools. No upload limits. No account needed. Merge, split, OCR, sign, compress — all in your browser. 🔒 Files auto-deleted. 📱 Works offline: https://pdf.idealsoftwaresolutions.com",
  "Need to OCR a scanned PDF? WiserFiles does it in your browser — no upload stored, no account required. Free, private, instant. https://pdf.idealsoftwaresolutions.com/tools/ocr-pdf",
  "Students: stop paying for PDF tools. WiserFiles has 30 tools — all free, all private. Files encrypted and auto-deleted. https://pdf.idealsoftwaresolutions.com",
  "TIL you can merge PDFs without uploading them to a sketchy website. WiserFiles processes everything in your browser. Nothing is stored. https://pdf.idealsoftwaresolutions.com/tools/merge-pdf",
  "Research students: WiserFiles has a built-in LaTeX editor with AI compile-fix suggestions. Free. https://pdf.idealsoftwaresolutions.com/research-studio",
  "PDF to Word with real formatting — not text dumps. WiserFiles converts server-side with LibreOffice. Free, private. https://pdf.idealsoftwaresolutions.com/tools/pdf-to-word",
  "Your PDF tool should not watermark or limit you. WiserFiles doesn't. 30 tools, zero catches. https://pdf.idealsoftwaresolutions.com",
  "Compare PDFs side by side — visual diff with color-coded changes. Free, in your browser. https://pdf.idealsoftwaresolutions.com/tools/compare-pdf",
  "Sign PDFs electronically. Draw or type your signature. No account, no upload stored. Free. https://pdf.idealsoftwaresolutions.com/tools/sign-pdf",
  "Compress PDFs without destroying quality. Your file never leaves your computer. https://pdf.idealsoftwaresolutions.com/tools/compress-pdf",
  "🎤 Speak your tool: 'compress my PDF' — WiserFiles finds the right tool instantly. https://pdf.idealsoftwaresolutions.com",
  "Redact sensitive information permanently. Text cannot be recovered. Secure, private. https://pdf.idealsoftwaresolutions.com/tools/redact-pdf",
];

const MARKETING_DIR = path.join(process.cwd(), "public", "marketing");

function jsonError(msg: string, status: number) {
  return Response.json({ error: msg }, { status });
}

async function checkAccess() {
  const { userId } = await auth();
  if (!userId) throw new Error("signin");
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const email = user.emailAddresses[0]?.emailAddress || "";
  if (!DASHBOARD_ALLOWED.includes(email)) {
    const role = await getUserRole(userId);
    if (role !== "admin") throw new Error("denied");
  }
  await ensureUserRecord(userId, email);
}

export async function GET(request: Request) {
  try {
    await checkAccess();
  } catch (e: any) {
    if (e.message === "signin") return jsonError("Sign in required.", 401);
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
      "30 free PDF tools. No account. No upload limits. Files auto-deleted. 📎🔒 #pdf #studenttips #productivity #edtech #freetools",
      "Your PDFs contain sensitive data. Stop uploading them to sketchy websites. Process locally. 🔒 #privacy #cybersecurity #pdftools #freetools",
      "🎤 Speak your PDF tool into existence. Voice search finds the right one instantly. Free. #voicecontrol #productivityhack #pdftools",
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
