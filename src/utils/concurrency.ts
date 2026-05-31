/**
 * Runs `fn` over `items` with bounded concurrency, preserving input order.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, limit), items.length || 1) },
    async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= items.length) break;
        results[idx] = await fn(items[idx]);
      }
    }
  );
  await Promise.all(workers);
  return results;
}
