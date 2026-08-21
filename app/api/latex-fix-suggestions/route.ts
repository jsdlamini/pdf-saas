export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { auth } from "@clerk/nextjs/server";
import { checkAndIncrementAiQuota } from "@/lib/ai-quota";

type CompileInputFile = {
  path: string;
  content: string;
};

type SuggestRequestPayload = {
  rootFile?: string;
  mainLog?: string;
  files?: CompileInputFile[];
};

type FixSuggestion = {
  title: string;
  why: string;
  steps: string[];
  patch?: string;
  files?: string[];
};

type SuggestResponsePayload = {
  summary: string;
  fixes: FixSuggestion[];
};

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function sanitizeText(raw: string, maxChars: number) {
  if (!raw) return "";
  return raw.length > maxChars ? raw.slice(raw.length - maxChars) : raw;
}

function sanitizeFiles(rawFiles: CompileInputFile[]) {
  const maxFiles = 10;
  const maxFileChars = 8000;

  return rawFiles
    .filter((file) => Boolean(file.path) && typeof file.path === "string")
    .slice(0, maxFiles)
    .map((file) => ({
      path: file.path,
      content: sanitizeText(typeof file.content === "string" ? file.content : "", maxFileChars),
    }));
}

function stripCodeFence(text: string) {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function parseAiResponse(text: string): SuggestResponsePayload {
  const cleaned = stripCodeFence(text);

  try {
    const parsed = JSON.parse(cleaned) as Partial<SuggestResponsePayload>;
    if (parsed && typeof parsed.summary === "string" && Array.isArray(parsed.fixes)) {
      const fixes: FixSuggestion[] = [];
      for (const fix of parsed.fixes) {
        if (!fix || typeof fix !== "object") continue;
        const data = fix as Partial<FixSuggestion>;
        if (!data.title || !data.why) continue;

        const nextFix: FixSuggestion = {
          title: data.title,
          why: data.why,
          steps: Array.isArray(data.steps)
            ? data.steps.filter((step): step is string => typeof step === "string")
            : [],
        };

        if (typeof data.patch === "string" && data.patch.trim()) {
          nextFix.patch = data.patch;
        }

        if (Array.isArray(data.files)) {
          const nextFiles = data.files.filter((path): path is string => typeof path === "string");
          if (nextFiles.length) nextFix.files = nextFiles;
        }

        fixes.push(nextFix);
      }

      return {
        summary: parsed.summary,
        fixes,
      };
    }
  } catch {
    // Fallback below.
  }

  return {
    summary: "AI returned an unstructured response. Review details below.",
    fixes: [
      {
        title: "Raw AI analysis",
        why: cleaned,
        steps: [],
        patch: "",
        files: [],
      },
    ],
  };
}

function buildPrompt(payload: { rootFile: string; mainLog: string; files: CompileInputFile[] }) {
  const filesText = payload.files
    .map((file) => `FILE: ${file.path}\n${file.content}`)
    .join("\n\n----------------\n\n");

  return [
    `Root file: ${payload.rootFile}`,
    "",
    "Compile log:",
    payload.mainLog,
    "",
    "Project files:",
    filesText || "(no files provided)",
    "",
    "Return STRICT JSON only with this schema:",
    "{",
    '  "summary": "one-paragraph diagnosis",',
    '  "fixes": [',
    "    {",
    '      "title": "short fix title",',
    '      "why": "why this resolves the error",',
    '      "steps": ["step 1", "step 2"],',
    '      "patch": "optional LaTeX snippet",',
    '      "files": ["path/to/file.tex"]',
    "    }",
    "  ]",
    "}",
    "",
    "Focus only on actionable fixes for the provided log and files.",
    "Never include markdown code fences.",
  ].join("\n");
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return jsonError("Sign in required.", 401);
  }

  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "anonymous";
  const quota = await checkAndIncrementAiQuota(userId, ip);
  if (!quota.allowed) {
    return jsonError(
      `Daily AI limit reached (${quota.used}/${quota.limit}). Try again tomorrow.`,
      429
    );
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return jsonError("DeepSeek API key is not configured on the server.", 503);
  }

  let payload: SuggestRequestPayload;
  try {
    payload = (await request.json()) as SuggestRequestPayload;
  } catch {
    return jsonError("Invalid JSON payload.", 400);
  }

  const mainLog = sanitizeText(typeof payload.mainLog === "string" ? payload.mainLog : "", 60_000);
  if (!mainLog.trim()) {
    return jsonError("Compile log is required for AI suggestions.", 400);
  }

  const rootFile = typeof payload.rootFile === "string" && payload.rootFile.trim() ? payload.rootFile : "main.tex";
  const files = sanitizeFiles(Array.isArray(payload.files) ? payload.files : []);
  const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";
  const apiUrl = process.env.DEEPSEEK_API_URL || "https://api.deepseek.com/chat/completions";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.15,
        max_tokens: 1200,
        messages: [
          {
            role: "system",
            content:
              "You are a senior LaTeX troubleshooting assistant. Diagnose compile logs and suggest minimal, precise fixes.",
          },
          {
            role: "user",
            content: buildPrompt({ rootFile, mainLog, files }),
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text();
      return jsonError(`DeepSeek request failed (${response.status}): ${sanitizeText(detail, 1000)}`, 502);
    }

    const raw = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = raw.choices?.[0]?.message?.content;
    if (!content || !content.trim()) {
      return jsonError("DeepSeek returned an empty response.", 502);
    }

    const parsed = parseAiResponse(content);
    return Response.json(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown DeepSeek error.";
    return jsonError(`DeepSeek request error: ${message}`, 502);
  } finally {
    clearTimeout(timeout);
  }
}
