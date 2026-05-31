import { describe, it, expect } from "vitest";
import { haversineDistance } from "../../src/utils/geo";

describe("haversineDistance", () => {
  it("is zero for identical points", () => {
    expect(haversineDistance(50.1, 14.4, 50.1, 14.4)).toBe(0);
  });

  it("approximates one degree of latitude (~111 km)", () => {
    const d = haversineDistance(0, 0, 1, 0);
    expect(d).toBeGreaterThan(111000);
    expect(d).toBeLessThan(111400);
  });

  it("matches the documented short-distance example (~65 m)", () => {
    const d = haversineDistance(50.0875, 14.4213, 50.088, 14.422);
    expect(d).toBeGreaterThan(40);
    expect(d).toBeLessThan(90);
  });

  it("is symmetric", () => {
    const a = haversineDistance(50.1, 14.4, 50.2, 14.5);
    const b = haversineDistance(50.2, 14.5, 50.1, 14.4);
    expect(Math.abs(a - b)).toBeLessThan(1e-6);
  });
});
