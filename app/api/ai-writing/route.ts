export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { auth } from "@clerk/nextjs/server";

type AiWritingAction = "summarize" | "rewrite" | "expand" | "improve";

type AiWritingPayload = {
  text: string;
  action: AiWritingAction;
};

const ACTION_PROMPTS: Record<AiWritingAction, string> = {
  summarize: "Condense the text into a concise summary, preserving key points. Return only the summarized text.",
  rewrite: "Rewrite the text with improved clarity and flow while preserving the original meaning. Return only the rewritten text.",
  expand: "Expand the text into more detail with elaboration, while preserving the original intent and tone. Return only the expanded text.",
  improve: "Improve the grammar, academic tone, and readability of the text. Return only the improved text.",
};

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function sanitizeText(raw: string, maxChars: number) {
  if (!raw) return "";
  return raw.length > maxChars ? raw.slice(0, maxChars) : raw;
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return jsonError("Sign in required.", 401);
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return jsonError("DeepSeek API key is not configured on the server.", 503);
  }

  let payload: AiWritingPayload;
  try {
    payload = (await request.json()) as AiWritingPayload;
  } catch {
    return jsonError("Invalid JSON payload.", 400);
  }

  const action = payload.action;
  if (!action || !(action in ACTION_PROMPTS)) {
    return jsonError("Provide a valid 'action' (summarize|rewrite|expand|improve).", 400);
  }

  const text = sanitizeText(typeof payload.text === "string" ? payload.text : "", 15_000);
  if (!text.trim()) {
    return jsonError("Provide text to process.", 400);
  }

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
        temperature: 0.3,
        max_tokens: 2000,
        messages: [
          {
            role: "system",
            content:
              "You are an academic writing assistant. Respond with ONLY the requested text, no explanations, no markdown fences.",
          },
          {
            role: "user",
            content: `${ACTION_PROMPTS[action]}\n\nText:\n${text}`,
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

    return Response.json({
      result: content.trim().replace(/^```[a-zA-Z]*\s*/g, "").replace(/\s*```$/g, ""),
      action,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown DeepSeek error.";
    return jsonError(`DeepSeek request error: ${message}`, 502);
  } finally {
    clearTimeout(timeout);
  }
}
