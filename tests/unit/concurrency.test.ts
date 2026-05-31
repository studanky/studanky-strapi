import { describe, it, expect } from "vitest";
import { mapWithConcurrency } from "../../src/utils/concurrency";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("mapWithConcurrency", () => {
  it("preserves input order", async () => {
    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (x) => x * 2);
    expect(out).toEqual([2, 4, 6, 8, 10]);
  });

  it("never exceeds the concurrency limit", async () => {
    let active = 0;
    let peak = 0;
    const out = await mapWithConcurrency(
      [1, 2, 3, 4, 5, 6, 7, 8],
      3,
      async (x) => {
        active++;
        peak = Math.max(peak, active);
        await delay(10);
        active--;
        return x;
      }
    );
    expect(out).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1); // actually parallel
  });

  it("handles an empty list", async () => {
    expect(await mapWithConcurrency([], 4, async (x) => x)).toEqual([]);
  });
});
