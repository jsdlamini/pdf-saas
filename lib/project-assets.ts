// Client-side helpers for recovering project image bytes from the asset store.

export function isBinaryAssetPath(path: string): boolean {
  return /\.(png|jpe?g|gif|bmp|webp|ico|pdf)$/i.test(path);
}

export type StoredAsset = { path: string; size?: number; content: string };

// The project JSON stores image entries with empty content (the bytes live in
// the asset store). After a reload those entries are empty forever unless we
// rehydrate them from the store. This merges stored bytes back in, keyed by
// path, and leaves non-image entries and unrecoverable images untouched.
export function mergeAssetContents<T extends { path: string; kind?: string; content: string }>(
  entries: T[],
  files: StoredAsset[]
): T[] {
  if (!files.length) return entries;
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  return entries.map((entry) => {
    if (entry.kind === "file" && isBinaryAssetPath(entry.path) && byPath.has(entry.path)) {
      return { ...entry, content: byPath.get(entry.path)! };
    }
    return entry;
  });
}

// Returns the image paths that are still empty after rehydration — i.e. the
// figures a reloaded project cannot recover from the store and must re-import.
export function unrecoverableAssetPaths<T extends { path: string; kind?: string; content: string }>(
  entries: T[]
): string[] {
  return entries
    .filter((e) => e.kind === "file" && isBinaryAssetPath(e.path) && !e.content)
    .map((e) => e.path);
}
