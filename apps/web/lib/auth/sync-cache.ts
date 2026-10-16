/**
 * Small TTL cache for "this user + organization + role is already mirrored
 * into our tables". It must never be used for an authorization decision:
 * the role is part of the key, so a role change is a different key and
 * misses the cache.
 */
export type SyncCache<T> = {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
};

export function syncKey(
  userId: string,
  orgId: string,
  orgRole: string | null | undefined
): string {
  // JSON, not "a:b:c": ids containing the delimiter cannot make two
  // different identities produce the same key.
  return JSON.stringify([userId, orgId, orgRole ?? null]);
}

export function createSyncCache<T>(options: {
  ttlMs: number;
  maxEntries: number;
  now?: () => number;
}): SyncCache<T> {
  const now = options.now ?? Date.now;
  const entries = new Map<string, { value: T; expiresAt: number }>();

  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value) {
      // Delete first so a re-set key moves to the newest position.
      entries.delete(key);
      if (entries.size >= options.maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }
      entries.set(key, { value, expiresAt: now() + options.ttlMs });
    }
  };
}
