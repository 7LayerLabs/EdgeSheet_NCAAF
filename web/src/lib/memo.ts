/**
 * Tiny in-process TTL memo for data that is too large for the Next fetch cache
 * (which skips responses over 2MB) or that is computed rather than fetched.
 * Lives as long as the server process; on serverless it lives per instance.
 */
const store = new Map<string, { at: number; ttl: number; value: Promise<unknown> }>();

export function memo<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  const now = Date.now();
  if (hit && now - hit.at < hit.ttl * 1000) return hit.value as Promise<T>;
  const value = fn().catch((err) => {
    store.delete(key);
    throw err;
  });
  store.set(key, { at: now, ttl: ttlSeconds, value });
  return value;
}

export function memoSync<T>(key: string, ttlSeconds: number, fn: () => T): T {
  const hit = store.get(key);
  const now = Date.now();
  if (hit && now - hit.at < hit.ttl * 1000) return hit.value as unknown as T;
  const value = fn();
  store.set(key, { at: now, ttl: ttlSeconds, value: value as unknown as Promise<unknown> });
  return value;
}
