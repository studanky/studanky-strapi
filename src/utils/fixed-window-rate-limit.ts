export interface FixedWindowLimit {
  windowMs: number;
  max: number;
}

export interface FixedWindowRateLimitResult {
  limited: boolean;
  retryAfterSeconds: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export const createFixedWindowRateLimiter = (
  limits: FixedWindowLimit[],
  options: { maxKeys?: number; now?: () => number } = {}
) => {
  const maxKeys = options.maxKeys ?? 10_000;
  const now = options.now ?? (() => Date.now());
  const store = new Map<string, Bucket[]>();
  const safeLimits = limits.filter(
    (limit) => limit.windowMs > 0 && limit.max > 0
  );

  const sweep = (timestamp = now()) => {
    for (const [key, buckets] of store) {
      if (buckets.every((bucket) => timestamp >= bucket.resetAt)) {
        store.delete(key);
      }
    }
  };

  return {
    consume(key: string, timestamp = now()): FixedWindowRateLimitResult {
      if (safeLimits.length === 0) {
        return { limited: false, retryAfterSeconds: 0 };
      }

      if (!store.has(key) && store.size >= maxKeys) {
        sweep(timestamp);
        if (store.size >= maxKeys) {
          const oldestKey = store.keys().next().value;
          if (oldestKey !== undefined) {
            store.delete(oldestKey);
          }
        }
      }

      let buckets = store.get(key);
      if (!buckets) {
        buckets = safeLimits.map((limit) => ({
          count: 0,
          resetAt: timestamp + limit.windowMs,
        }));
        store.set(key, buckets);
      } else {
        // Keep the map as a simple LRU so maxKeys pressure evicts stale/rare
        // keys instead of failing closed for new legitimate subscribers.
        store.delete(key);
        store.set(key, buckets);
      }

      for (let i = 0; i < safeLimits.length; i += 1) {
        const limit = safeLimits[i];
        const bucket = buckets[i];

        if (timestamp >= bucket.resetAt) {
          bucket.count = 0;
          bucket.resetAt = timestamp + limit.windowMs;
        }

        if (bucket.count >= limit.max) {
          return {
            limited: true,
            retryAfterSeconds: Math.max(
              1,
              Math.ceil((bucket.resetAt - timestamp) / 1000)
            ),
          };
        }
      }

      for (const bucket of buckets) {
        bucket.count += 1;
      }

      return { limited: false, retryAfterSeconds: 0 };
    },

    sweep,

    reset() {
      store.clear();
    },

    size() {
      return store.size;
    },
  };
};
