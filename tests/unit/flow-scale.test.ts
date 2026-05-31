import { describe, it, expect } from "vitest";
import { pickFlowScale, type FlowRange } from "../../src/utils/flow-scale";

const ranges: FlowRange[] = [
  { scale: 1, min_lps: 0, max_lps: 0.5 },
  { scale: 2, min_lps: 0.5, max_lps: 1.5 },
  { scale: 3, min_lps: 1.5, max_lps: 5 },
];

describe("pickFlowScale", () => {
  it("maps a value inside a range to its scale", () => {
    expect(pickFlowScale(ranges, 1.0)).toBe(2);
    expect(pickFlowScale(ranges, 3)).toBe(3);
  });

  it("includes range boundaries (min and max inclusive)", () => {
    expect(pickFlowScale(ranges, 0)).toBe(1); // min of first
    // 0.5 is in both range 1 [0,0.5] and range 2 [0.5,1.5] → first match wins
    expect(pickFlowScale(ranges, 0.5)).toBe(1);
    expect(pickFlowScale(ranges, 5)).toBe(3); // max of last
  });

  it("returns null when the value is outside every range", () => {
    expect(pickFlowScale(ranges, 10)).toBeNull();
    expect(pickFlowScale(ranges, -1)).toBeNull();
  });

  it("returns null with no/empty ranges", () => {
    expect(pickFlowScale([], 1)).toBeNull();
    expect(pickFlowScale(undefined, 1)).toBeNull();
    expect(pickFlowScale(null, 1)).toBeNull();
  });

  it("returns null for null/undefined/NaN value", () => {
    expect(pickFlowScale(ranges, null)).toBeNull();
    expect(pickFlowScale(ranges, undefined)).toBeNull();
    expect(pickFlowScale(ranges, Number.NaN)).toBeNull();
  });
});
