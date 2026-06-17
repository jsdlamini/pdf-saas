import { TOOL_ITEMS } from "@/lib/tools";
import { WORKFLOW_RECIPES } from "@/lib/workflow-recipes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IntakeFile = {
  name: string;
  mime: string;
  sizeBytes: number;
};

type IntakeRequestPayload = {
  files?: IntakeFile[];
  estimatedInputType?: "pdf" | "image" | "office" | "mixed";
  scanLikelihood?: "high" | "medium" | "low" | "unknown";
  findings?: string[];
  textPreview?: string;
  /** Slug of the tool the user currently has open, e.g. "sign-pdf". */
  currentToolSlug?: string;
};

type RecommendedWorkflow = {
  recipeSlug: string;
  recipeName: string;
  description: string;
  steps: Array<{ toolSlug: string; label: string }>;
};

type SmartIntakeResponse = {
  documentType: string;
  intakeSummary: string;
  confidence: "high" | "medium" | "low";
  recommendedWorkflow: RecommendedWorkflow | null;
  warnings: string[];
  source: "ai" | "fallback";
};

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function sanitizeText(raw: string, maxChars: number) {
  if (!raw) return "";
  return raw.length > maxChars ? raw.slice(0, maxChars) : raw;
}

function stripCodeFence(text: string) {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function removeInitialWordRepetition(text: string) {
  const words = text.trim().split(/\s+/);
  if (words.length < 2) return text.trim();

  // Clean consecutive repeated words near the beginning, e.g. "The The" or "about about".
  const limit = Math.min(words.length, 16);
  for (let index = 1; index < limit; index += 1) {
    if (words[index].toLowerCase() === words[index - 1].toLowerCase()) {
      words.splice(index, 1);
      index -= 1;
    }
  }

  return words.join(" ").trim();
}

function normalizeIntakeSummary(summary: string) {
  const cleaned = removeInitialWordRepetition(summary.replace(/\s+/g, " ").trim());
  if (!cleaned) {
    return "The uploaded file is about a document workflow that can be processed with PaperTrail tools.";
  }

  const deDuplicatedStarter = cleaned
    .replace(/^(the uploaded file is about)\s+\1\s+/i, "$1 ")
    .replace(/^(this file is discussing)\s+\1\s+/i, "$1 ");

  const normalized = removeInitialWordRepetition(deDuplicatedStarter);

  const lower = normalized.toLowerCase();
  if (lower.startsWith("the uploaded file is about") || lower.startsWith("this file is discussing")) {
    return normalized;
  }

  return `The uploaded file is about ${normalized.charAt(0).toLowerCase()}${normalized.slice(1)}`;
}

function fallbackIntake(payload: IntakeRequestPayload): SmartIntakeResponse {
  const files = Array.isArray(payload.files) ? payload.files : [];
  const warnings: string[] = [];

  // Prefer a recipe that contains the tool the user is currently using.
  const recipeContainingCurrentTool = payload.currentToolSlug
    ? WORKFLOW_RECIPES.find((r) => r.steps.some((s) => s.toolSlug === payload.currentToolSlug))
    : undefined;

  // Pick the best workflow based on available signals
  let recipe = recipeContainingCurrentTool ?? WORKFLOW_RECIPES[0];
  if (!recipeContainingCurrentTool) {
    if ((payload.scanLikelihood || "unknown") === "high" || (payload.estimatedInputType || "mixed") === "image") {
      recipe = WORKFLOW_RECIPES.find((r) => r.slug === "image-ingest") ?? recipe;
    } else if (files.length > 1) {
      recipe = WORKFLOW_RECIPES.find((r) => r.slug === "archive-cleanup") ?? recipe;
    }
  }

  return {
    documentType: payload.estimatedInputType === "pdf" ? "General PDF" : "Mixed Documents",
    intakeSummary: "The uploaded file is about a general document workflow, and this summary was generated using fallback analysis.",
    confidence: "medium",
    recommendedWorkflow: {
      recipeSlug: recipe.slug,
      recipeName: recipe.name,
      description: recipe.description,
      steps: recipe.steps,
    },
    warnings,
    source: "fallback",
  };
}

function parseAiResponse(content: string): SmartIntakeResponse | null {
  const cleaned = stripCodeFence(content);

  try {
    const parsed = JSON.parse(cleaned) as Partial<SmartIntakeResponse>;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.documentType !== "string" || typeof parsed.intakeSummary !== "string") return null;
    if (parsed.confidence !== "high" && parsed.confidence !== "medium" && parsed.confidence !== "low") return null;

    const validRecipeSlugs = new Set(WORKFLOW_RECIPES.map((r) => r.slug));
    const rawWorkflow = parsed.recommendedWorkflow as Partial<RecommendedWorkflow> | null | undefined;
    let workflow: RecommendedWorkflow | null = null;
    if (rawWorkflow && typeof rawWorkflow === "object" && typeof rawWorkflow.recipeSlug === "string" && validRecipeSlugs.has(rawWorkflow.recipeSlug)) {
      const matched = WORKFLOW_RECIPES.find((r) => r.slug === rawWorkflow.recipeSlug);
      if (matched) {
        workflow = { recipeSlug: matched.slug, recipeName: matched.name, description: matched.description, steps: matched.steps };
      }
    }
    // If AI didn't return a valid workflow, fall back to first recipe
    if (!workflow) {
      const fallbackRecipe = WORKFLOW_RECIPES[0];
      workflow = { recipeSlug: fallbackRecipe.slug, recipeName: fallbackRecipe.name, description: fallbackRecipe.description, steps: fallbackRecipe.steps };
    }

    return {
      documentType: parsed.documentType,
      intakeSummary: normalizeIntakeSummary(parsed.intakeSummary),
      confidence: parsed.confidence,
      recommendedWorkflow: workflow,
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings.filter((value): value is string => typeof value === "string") : [],
      source: "ai",
    };
  } catch {
    return null;
  }
}

function buildPrompt(payload: Required<Pick<IntakeRequestPayload, "files" | "estimatedInputType" | "scanLikelihood" | "findings" | "textPreview">> & { currentToolSlug?: string }) {
  const availableTools = TOOL_ITEMS.map((item) => `${item.slug}: ${item.name} (${item.category})`).join("\n");
  const availableWorkflows = WORKFLOW_RECIPES.map(
    (r) => `${r.slug}: ${r.name} — ${r.description} (steps: ${r.steps.map((s) => s.toolSlug).join(" → ")})`
  ).join("\n");
  const files = payload.files
    .map((file) => `- ${file.name} | mime=${file.mime || "unknown"} | size=${Math.round(file.sizeBytes / 1024)}KB`)
    .join("\n");

  return [
    "You are a document intake triage assistant for a PDF tool suite.",
    "Return STRICT JSON only, no markdown.",
    "",
    "Available tools:",
    availableTools,
    "",
    "Available workflows (pick ONE that best fits the document):",
    availableWorkflows,
    "",
    "Input summary:",
    `estimatedInputType=${payload.estimatedInputType}`,
    `scanLikelihood=${payload.scanLikelihood}`,
    "files:",
    files || "(none)",
    "findings:",
    payload.findings.length ? payload.findings.map((item) => `- ${item}`).join("\n") : "(none)",
    "textPreview:",
    payload.textPreview || "(none)",
    "",
    "Respond with JSON schema:",
    "{",
    '  "documentType": "short category label",',
    '  "intakeSummary": "one concise sentence",',
    '  "confidence": "high|medium|low",',
    '  "recommendedWorkflow": { "recipeSlug": "one-of-the-workflow-slugs-above" },',
    '  "warnings": ["optional warning"]',
    "}",
    "",
    payload.currentToolSlug ? `currentToolSlug=${payload.currentToolSlug} (the tool the user currently has open — strongly prefer a workflow that includes this tool)` : "",
    "",
    "Rules:",
    "- recipeSlug must be one of the slugs from Available workflows.",
    "- If currentToolSlug is provided, you MUST choose a workflow whose steps include that tool slug unless absolutely no such workflow exists.",
    "- Pick the workflow whose steps best match the document type and likely next actions.",
    "- Keep intakeSummary under 160 characters.",
    "- Make intakeSummary human-friendly and start with 'The uploaded file is about' or 'This file is discussing'.",
  ].join("\n");
}

export async function POST(request: Request) {
  let payload: IntakeRequestPayload;
  try {
    payload = (await request.json()) as IntakeRequestPayload;
  } catch {
    return jsonError("Invalid JSON payload.", 400);
  }

  const files = (Array.isArray(payload.files) ? payload.files : [])
    .filter((file) => file && typeof file.name === "string")
    .slice(0, 8)
    .map((file) => ({
      name: sanitizeText(file.name, 180),
      mime: sanitizeText(typeof file.mime === "string" ? file.mime : "", 120),
      sizeBytes: Math.max(0, Math.floor(Number(file.sizeBytes) || 0)),
    }));

  const normalized: Required<Pick<IntakeRequestPayload, "files" | "estimatedInputType" | "scanLikelihood" | "findings" | "textPreview">> & { currentToolSlug?: string } = {
    files,
    estimatedInputType: payload.estimatedInputType || "mixed",
    scanLikelihood: payload.scanLikelihood || "unknown",
    findings: Array.isArray(payload.findings) ? payload.findings.filter((item): item is string => typeof item === "string").slice(0, 10) : [],
    textPreview: sanitizeText(typeof payload.textPreview === "string" ? payload.textPreview : "", 2200),
    currentToolSlug: typeof payload.currentToolSlug === "string" ? sanitizeText(payload.currentToolSlug, 80) : undefined,
  };

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return Response.json(fallbackIntake(normalized));
  }

  const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";
  const apiUrl = process.env.DEEPSEEK_API_URL || "https://api.deepseek.com/chat/completions";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 700,
        messages: [
          {
            role: "system",
            content: "You are a precise document intake classifier and tool router.",
          },
          {
            role: "user",
            content: buildPrompt(normalized),
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return Response.json(fallbackIntake(normalized));
    }

    const raw = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = raw.choices?.[0]?.message?.content;
    if (!content || !content.trim()) {
      return Response.json(fallbackIntake(normalized));
    }

    const parsed = parseAiResponse(content);
    if (!parsed) {
      return Response.json(fallbackIntake(normalized));
    }

    // If the AI ignored the currentToolSlug hint and suggested a workflow that
    // doesn't contain the current tool, override with the fallback which does.
    if (
      normalized.currentToolSlug &&
      parsed.recommendedWorkflow &&
      !parsed.recommendedWorkflow.steps.some((s) => s.toolSlug === normalized.currentToolSlug)
    ) {
      const override = WORKFLOW_RECIPES.find((r) =>
        r.steps.some((s) => s.toolSlug === normalized.currentToolSlug)
      );
      if (override) {
        parsed.recommendedWorkflow = {
          recipeSlug: override.slug,
          recipeName: override.name,
          description: override.description,
          steps: override.steps,
        };
      }
    }

    return Response.json(parsed);
  } catch {
    return Response.json(fallbackIntake(normalized));
  } finally {
    clearTimeout(timeout);
  }
}
