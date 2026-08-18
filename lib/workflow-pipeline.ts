export type WorkflowPipelinePayload = {
  fromToolSlug: string;
  toToolSlug: string;
  recipeSlug?: string;
  fileName: string;
  mime: string;
  blob: Blob;
  files?: Array<{ name: string; type: string; blob: Blob }>;
  createdAt: number;
};

const DB_NAME = "wiserfiles-pipeline";
const DB_VERSION = 1;
const STORE = "payloads";

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

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function clonePayload(payload: WorkflowPipelinePayload): WorkflowPipelinePayload {
  return {
    ...payload,
    blob: new Blob([payload.blob], { type: payload.blob.type }),
    files: payload.files?.map((f) => ({ name: f.name, type: f.type, blob: new Blob([f.blob], { type: f.blob.type }) })),
  };
}

export function stageWorkflowPipeline(payload: WorkflowPipelinePayload) {
  const store = getStore();
  if (store) store[payload.toToolSlug] = payload;

  // Persist to IndexedDB so the pipeline survives a full page reload.
  void (async () => {
    try {
      const db = await openDb();
      const tx = db.transaction(STORE, "readwrite");
      const os = tx.objectStore(STORE);
      os.put(clonePayload(payload), payload.toToolSlug);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch {
      // persistence is best-effort
    }
  })();
}

export function consumeWorkflowPipeline(toolSlug: string, maxAgeMs = 30 * 60 * 1000) {
  const store = getStore();
  if (!store) return null;
  const payload = store[toolSlug];
  if (!payload) return null;

  delete store[toolSlug];
  void clearPersistedPipeline(toolSlug);

  if (Date.now() - payload.createdAt > maxAgeMs) {
    return null;
  }
  return payload;
}

async function clearPersistedPipeline(toolSlug: string) {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(toolSlug);
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    // best-effort
  }
}

export function clearWorkflowPipeline(toolSlug: string) {
  const store = getStore();
  if (store) delete store[toolSlug];
  void clearPersistedPipeline(toolSlug);
}

// Load a pipeline payload that may have been persisted (survives full reloads).
export async function loadPersistedWorkflowPipeline(toolSlug: string, maxAgeMs = 30 * 60 * 1000): Promise<WorkflowPipelinePayload | null> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readonly");
    const os = tx.objectStore(STORE);
    const payload = await new Promise<WorkflowPipelinePayload | undefined>((resolve) => {
      const req = os.get(toolSlug) as IDBRequest<WorkflowPipelinePayload | undefined>;
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    });
    db.close();

    if (!payload) return null;
    if (Date.now() - payload.createdAt > maxAgeMs) {
      await clearPersistedPipeline(toolSlug);
      return null;
    }
    // Consume (delete) so it isn't reused.
    await clearPersistedPipeline(toolSlug);
    const store = getStore();
    if (store) delete store[toolSlug];
    return payload;
  } catch {
    return null;
  }
}
