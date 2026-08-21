// In-memory fixed-window rate limiter with eviction.
//
// A plain Map keyed by user/IP that only filters stale timestamps on lookup
// still grows without bound (a slow leak, reset on every deploy). This caps
// the entry count and prunes fully-expired keys so the map stays bounded.

export type RateLimiter = (key: string) => boolean;

export function createRateLimiter(
  windowMs: number,
  maxRequests: number,
  maxEntries = 10_000
): RateLimiter {
  const map = new Map<string, number[]>();

  return function check(key: string): boolean {
    const now = Date.now();
    const times = (map.get(key) || []).filter((t) => now - t < windowMs);
    if (times.length >= maxRequests) {
      map.set(key, times);
      return false;
    }
    times.push(now);
    map.set(key, times);

    if (map.size > maxEntries) {
      // Prune keys whose entries are all expired; if none qualify (a burst of
      // distinct keys), drop the oldest key to keep the map bounded.
      let pruned = false;
      for (const [k, v] of map) {
        if (v.every((t) => now - t >= windowMs)) {
          map.delete(k);
          pruned = true;
          if (map.size <= maxEntries) break;
        }
      }
      if (!pruned && map.size > maxEntries) {
        const firstKey = map.keys().next().value;
        if (firstKey !== undefined) map.delete(firstKey);
      }
    }

    return true;
  };
}
