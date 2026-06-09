import { describe, it, expect } from "vitest";
import { haversineMeters, isValidOrigin } from "../../src/utils/geo";

describe("haversineMeters", () => {
  it("returns 0 for identical points", () => {
    expect(haversineMeters(50.08, 14.43, 50.08, 14.43)).toBe(0);
  });

  it("matches a known distance (Prague → Brno ≈ 184 km)", () => {
    const d = haversineMeters(50.0755, 14.4378, 49.1951, 16.6068);
    expect(d / 1000).toBeGreaterThan(180);
    expect(d / 1000).toBeLessThan(190);
  });

  it("is symmetric", () => {
    const a = haversineMeters(50.18, 17.05, 49.2, 16.6);
    const b = haversineMeters(49.2, 16.6, 50.18, 17.05);
    expect(a).toBeCloseTo(b, 5);
  });

  it("resolves ~200 m for a small offset (geofence sanity)", () => {
    // ~0.0018° latitude ≈ 200 m
    const d = haversineMeters(50.0, 14.0, 50.0018, 14.0);
    expect(d).toBeGreaterThan(180);
    expect(d).toBeLessThan(220);
  });

  it("returns NaN when any coordinate is not finite", () => {
    expect(haversineMeters(Number.NaN, 14, 50, 14)).toBeNaN();
    expect(haversineMeters(50, 14, 50, Infinity)).toBeNaN();
  });
});

describe("isValidOrigin", () => {
  it("accepts in-range finite coordinates", () => {
    expect(isValidOrigin(50.08, 14.43)).toBe(true);
    expect(isValidOrigin(0, 0)).toBe(true);
  });

  it("rejects out-of-range coordinates", () => {
    expect(isValidOrigin(91, 14)).toBe(false);
    expect(isValidOrigin(50, 181)).toBe(false);
  });

  it("rejects undefined / NaN", () => {
    expect(isValidOrigin(undefined, 14)).toBe(false);
    expect(isValidOrigin(50, undefined)).toBe(false);
    expect(isValidOrigin(Number.NaN, Number.NaN)).toBe(false);
  });
});
