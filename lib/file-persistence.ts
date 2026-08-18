// Lightweight IndexedDB persistence for uploaded files, so a page refresh
// doesn't wipe the user's uploads. Keyed by tool slug.

const DB_NAME = "wiserfiles-files";
const DB_VERSION = 1;
const STORE = "uploads";

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
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

type StoredFile = {
  id: string;
  toolSlug: string;
  name: string;
  type: string;
  size: number;
  data: ArrayBuffer;
  createdAt: number;
};

export async function persistUploadedFiles(toolSlug: string, files: File[]): Promise<void> {
  try {
    // Read all file bytes BEFORE opening the transaction. IndexedDB transactions
    // auto-commit when there are no pending requests, so any await inside the
    // transaction body (e.g. file.arrayBuffer()) silently breaks the writes.
    const buffers = await Promise.all(files.map((file) => file.arrayBuffer()));

    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);

    // Clear existing files for this tool.
    const clearReq = store.openCursor();
    clearReq.onsuccess = () => {
      const cursor = clearReq.result;
      if (!cursor) return;
      const entry = cursor.value as StoredFile;
      if (entry.toolSlug === toolSlug) cursor.delete();
      cursor.continue();
    };

    // Store the new batch synchronously within the transaction.
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      const record: StoredFile = {
        id: `${toolSlug}:${file.name}:${file.size}`,
        toolSlug,
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        data: buffers[i],
        createdAt: Date.now(),
      };
      store.put(record);
    }

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Persistence is best-effort; ignore failures in restricted contexts.
  }
}

export async function loadUploadedFiles(toolSlug: string): Promise<File[]> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const all = await new Promise<StoredFile[]>((resolve) => {
      const req = store.getAll() as IDBRequest<StoredFile[]>;
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
    db.close();

    return all
      .filter((entry) => entry.toolSlug === toolSlug)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((entry) => new File([entry.data], entry.name, { type: entry.type }));
  } catch {
    return [];
  }
}

export async function clearUploadedFiles(toolSlug: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const all = await new Promise<StoredFile[]>((resolve) => {
      const req = store.getAll() as IDBRequest<StoredFile[]>;
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
    for (const entry of all) {
      if (entry.toolSlug === toolSlug) store.delete(entry.id);
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // best-effort
  }
}
