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
    description: "OCR scanned files, normalize ordering, then compress for long-term storage.",
    steps: [
      { toolSlug: "ocr-pdf", label: "OCR and text layer recovery" },
      { toolSlug: "organize-pdf", label: "Reorder and remove noise pages" },
      { toolSlug: "compress-pdf", label: "Reduce storage size" },
    ],
  },
  {
    slug: "legal-review-pack",
    name: "Legal Review Pack",
    description: "Redact sensitive content, encrypt for distribution, then add a final signature mark.",
    steps: [
      { toolSlug: "redact-pdf", label: "Permanent sensitive-content removal" },
      { toolSlug: "protect-pdf", label: "Encrypt output for distribution" },
      { toolSlug: "sign-pdf", label: "Apply approval signature" },
    ],
  },
  {
    slug: "client-signoff",
    name: "Client Sign-off",
    description: "Prepare a lighter file, place signatures, and export review-ready output.",
    steps: [
      { toolSlug: "compress-pdf", label: "Optimize file size" },
      { toolSlug: "sign-pdf", label: "Apply signature" },
      { toolSlug: "page-numbers", label: "Add review-friendly pagination" },
    ],
  },
  {
    slug: "image-ingest",
    name: "Image Ingest",
    description: "Convert camera/image inputs to PDF, OCR them, and send as searchable docs.",
    steps: [
      { toolSlug: "images-to-pdf", label: "Convert images to PDF" },
      { toolSlug: "ocr-pdf", label: "Extract searchable text" },
      { toolSlug: "compress-pdf", label: "Reduce size for sharing" },
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
