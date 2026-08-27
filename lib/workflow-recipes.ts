export type WorkflowRecipeStep = {
  toolSlug: string;
  label: string;
};

export type WorkflowRecipe = {
  slug: string;
  name: string;
  description: string;
  steps: WorkflowRecipeStep[];
};

export const WORKFLOW_RECIPES: WorkflowRecipe[] = [
  {
    slug: "archive-cleanup",
    name: "Archive Cleanup",
    description: "Turn a folder of old scans into something tidy, searchable and small.",
    steps: [
      { toolSlug: "ocr-pdf", label: "Make the scans searchable" },
      { toolSlug: "organize-pdf", label: "Fix the page order" },
      { toolSlug: "compress-pdf", label: "Shrink it for storage" },
    ],
  },
  {
    slug: "legal-review-pack",
    name: "Legal Review Pack",
    description: "Redact what's sensitive, lock it, sign it.",
    steps: [
      { toolSlug: "redact-pdf", label: "Black out the sensitive bits" },
      { toolSlug: "protect-pdf", label: "Set a password" },
      { toolSlug: "sign-pdf", label: "Sign it" },
    ],
  },
  {
    slug: "client-signoff",
    name: "Client Sign-off",
    description: "Send a lighter file your client can sign and page through.",
    steps: [
      { toolSlug: "compress-pdf", label: "Make it email-sized" },
      { toolSlug: "sign-pdf", label: "They sign" },
      { toolSlug: "page-numbers", label: "Number the pages" },
    ],
  },
  {
    slug: "image-ingest",
    name: "Image Ingest",
    description: "Phone photos of documents, into a searchable PDF.",
    steps: [
      { toolSlug: "convert-to-pdf", label: "Photos into a PDF" },
      { toolSlug: "ocr-pdf", label: "Make the text searchable" },
      { toolSlug: "compress-pdf", label: "Shrink it" },
    ],
  },
];

export function getRecipesForTool(toolSlug: string) {
  return WORKFLOW_RECIPES.filter((recipe) => recipe.steps.some((step) => step.toolSlug === toolSlug));
}

export function getNextRecipeStep(recipe: WorkflowRecipe, currentToolSlug: string) {
  const index = recipe.steps.findIndex((step) => step.toolSlug === currentToolSlug);
  if (index < 0) return null;
  return recipe.steps[index + 1] ?? null;
}
