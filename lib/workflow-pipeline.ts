export type WorkflowPipelinePayload = {
  fromToolSlug: string;
  toToolSlug: string;
  recipeSlug?: string;
  fileName: string;
  mime: string;
  blob: Blob;
  createdAt: number;
};

declare global {
  interface Window {
    __wiserfilesPipelineStore?: Record<string, WorkflowPipelinePayload>;
  }
}

function getStore() {
  if (typeof window === "undefined") return null;
  window.__wiserfilesPipelineStore ??= {};
  return window.__wiserfilesPipelineStore;
}

export function stageWorkflowPipeline(payload: WorkflowPipelinePayload) {
  const store = getStore();
  if (!store) return;
  store[payload.toToolSlug] = payload;
}

export function consumeWorkflowPipeline(toolSlug: string, maxAgeMs = 30 * 60 * 1000) {
  const store = getStore();
  if (!store) return null;
  const payload = store[toolSlug];
  if (!payload) return null;

  delete store[toolSlug];
  if (Date.now() - payload.createdAt > maxAgeMs) {
    return null;
  }

  return payload;
}

export function clearWorkflowPipeline(toolSlug: string) {
  const store = getStore();
  if (!store) return;
  delete store[toolSlug];
}
