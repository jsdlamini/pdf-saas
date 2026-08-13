export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { auth } from "@clerk/nextjs/server";
import { checkAndIncrementAiQuota } from "@/lib/ai-quota";

type ReviewPayload = {
  text: string;
  title?: string;
};

type ReviewSection = {
  heading: string;
  points: string[];
};

type ReviewResponse = {
  summary: string;
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  score: number;
};

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function sanitizeText(raw: string, maxChars: number) {
  if (!raw) return "";
  return raw.length > maxChars ? raw.slice(0, maxChars) : raw;
}

function stripCodeFence(text: string) {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function parseReview(text: string): ReviewResponse {
  const cleaned = stripCodeFence(text);
  try {
    const parsed = JSON.parse(cleaned) as Partial<ReviewResponse>;
    if (parsed && typeof parsed.summary === "string") {
      return {
        summary: parsed.summary,
        strengths: Array.isArray(parsed.strengths) ? parsed.strengths.filter((s): s is string => typeof s === "string") : [],
        weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses.filter((s): s is string => typeof s === "string") : [],
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.filter((s): s is string => typeof s === "string") : [],
        score: typeof parsed.score === "number" ? parsed.score : 0,
      };
    }
  } catch {
    // fall through
  }

  return {
    summary: cleaned,
    strengths: [],
    weaknesses: [],
    suggestions: [],
    score: 0,
  };
}

export async function POST(request: Request) {
  const { userId } = await auth();
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "anonymous";
  const quota = await checkAndIncrementAiQuota(userId, ip);
  if (!quota.allowed) {
    return jsonError(
      `Daily AI limit reached (${quota.used}/${quota.limit}). Sign in for a higher limit, or try again tomorrow.`,
      429
    );
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return jsonError("DeepSeek API key is not configured on the server.", 503);
  }

  let payload: ReviewPayload;
  try {
    payload = (await request.json()) as ReviewPayload;
  } catch {
    return jsonError("Invalid JSON payload.", 400);
  }

  const text = sanitizeText(typeof payload.text === "string" ? payload.text : "", 30_000);
  if (!text.trim()) {
    return jsonError("Provide text to review.", 400);
  }
  const title = sanitizeText(typeof payload.title === "string" ? payload.title : "", 200);

  const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";
  const apiUrl = process.env.DEEPSEEK_API_URL || "https://api.deepseek.com/chat/completions";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_tokens: 2000,
        messages: [
          {
            role: "system",
            content:
              "You are a rigorous academic peer reviewer. Critique the paper critically but constructively. Return STRICT JSON only, no markdown fences.",
          },
          {
            role: "user",
            content: [
              `Review the following academic document${title ? ` titled "${title}"` : ""}.`,
              "Return JSON with this schema:",
              "{",
              '  "summary": "one-paragraph overall assessment",',
              '  "strengths": ["strength 1", "strength 2"],',
              '  "weaknesses": ["weakness 1", "weakness 2"],',
              '  "suggestions": ["concrete improvement 1", "concrete improvement 2"],',
              '  "score": 0-10 overall score',
              "}",
              "",
              "Document text:",
              text,
            ].join("\n"),
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

    return Response.json(parseReview(content));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown DeepSeek error.";
    return jsonError(`DeepSeek request error: ${message}`, 502);
  } finally {
    clearTimeout(timeout);
  }
}
