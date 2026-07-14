import { describe, expect, it } from "vitest";
import { createFixedWindowRateLimiter } from "../../src/utils/fixed-window-rate-limit";

describe("createFixedWindowRateLimiter", () => {
  it("limits after max attempts and resets after the window", () => {
    let now = 1_000;
    const limiter = createFixedWindowRateLimiter(
      [{ windowMs: 10_000, max: 2 }],
      { now: () => now }
    );

    expect(limiter.consume("email-hash").limited).toBe(false);
    expect(limiter.consume("email-hash").limited).toBe(false);

    const limited = limiter.consume("email-hash");
    expect(limited.limited).toBe(true);
    expect(limited.retryAfterSeconds).toBe(10);

    now = 11_001;
    expect(limiter.consume("email-hash").limited).toBe(false);
  });

  it("keeps independent buckets per key", () => {
    const limiter = createFixedWindowRateLimiter([
      { windowMs: 10_000, max: 1 },
    ]);

    expect(limiter.consume("a").limited).toBe(false);
    expect(limiter.consume("a").limited).toBe(true);
    expect(limiter.consume("b").limited).toBe(false);
  });

  it("evicts the least recently used key when maxKeys is exhausted", () => {
    const limiter = createFixedWindowRateLimiter(
      [{ windowMs: 10_000, max: 10 }],
      { maxKeys: 2 }
    );

    expect(limiter.consume("a").limited).toBe(false);
    expect(limiter.consume("b").limited).toBe(false);
    expect(limiter.consume("a").limited).toBe(false);
    expect(limiter.consume("c").limited).toBe(false);
    expect(limiter.size()).toBe(2);

    // `b` was least recently used and got evicted, so it starts fresh.
    expect(limiter.consume("b").limited).toBe(false);
  });
});
