import { describe, expect, it } from "vitest";
import { normalizeSearchText } from "../../src/utils/search";

describe("normalizeSearchText", () => {
  it("removes Czech diacritics and lowercases text", () => {
    expect(normalizeSearchText("Ostružná")).toBe("ostruzna");
    expect(normalizeSearchText("Výprachtice")).toBe("vyprachtice");
    expect(normalizeSearchText("Staré Hutě")).toBe("stare hute");
  });

  it("normalizes whitespace", () => {
    expect(normalizeSearchText("  Český\t  Krumlov\n")).toBe("cesky krumlov");
  });

  it("handles already decomposed accents", () => {
    expect(normalizeSearchText("Cafe\u0301")).toBe("cafe");
  });

  it("returns an empty string for non-string input", () => {
    expect(normalizeSearchText(null)).toBe("");
    expect(normalizeSearchText(undefined)).toBe("");
  });
});
