import { describe, it, expect } from "vitest";
import { resolveLocaleChain } from "../../src/utils/locale";

const configured = ["cs", "en", "en-US", "de"];

describe("resolveLocaleChain", () => {
  it("tries the requested locale first, then the default, when both are configured and distinct", () => {
    expect(
      resolveLocaleChain({ requested: "cs", defaultLocale: "en", configured }),
    ).toEqual(["cs", "en"]);
  });

  it("normalizes separators and casing while preserving configured codes", () => {
    expect(
      resolveLocaleChain({
        requested: "EN_us",
        defaultLocale: "cs",
        configured,
      }),
    ).toEqual(["en-US", "en", "cs"]);
  });

  it("falls back from an unavailable regional locale to its base and configured siblings", () => {
    expect(
      resolveLocaleChain({
        requested: "en-GB",
        defaultLocale: "cs",
        configured,
      }),
    ).toEqual(["en", "en-US", "cs"]);
  });

  it("uses a preferred same-language variant before a different-language default", () => {
    expect(
      resolveLocaleChain({
        requested: "en-AU",
        defaultLocale: "cs",
        sourceLocale: "cs",
        configured: ["cs", "en-US", "en-GB"],
        preferredVariants: { en: ["en-US", "en-GB"] },
      }),
    ).toEqual(["en-US", "en-GB", "cs"]);
  });

  it("accepts a base client tag and negotiates a configured regional variant", () => {
    expect(
      resolveLocaleChain({
        requested: "en",
        defaultLocale: "cs",
        configured: ["cs", "en-US"],
      }),
    ).toEqual(["en-US", "cs"]);
  });

  it("preserves script-aware parent fallback", () => {
    expect(
      resolveLocaleChain({
        requested: "sr-Latn-RS",
        defaultLocale: "cs",
        configured: ["cs", "sr", "sr-Latn", "sr-Cyrl"],
      }),
    ).toEqual(["sr-Latn", "sr", "sr-Cyrl", "cs"]);
  });

  it("deduplicates requested/default while retaining another same-language variant", () => {
    expect(
      resolveLocaleChain({ requested: "en", defaultLocale: "en", configured }),
    ).toEqual(["en", "en-US"]);
  });

  it("drops an unsupported (unconfigured) requested locale → default only", () => {
    // 'fr' is not configured → never queried, avoids depending on how the
    // Document Service reacts to an unknown locale.
    expect(
      resolveLocaleChain({ requested: "fr", defaultLocale: "en", configured }),
    ).toEqual(["en"]);
  });

  it("falls back to default when no locale is requested", () => {
    expect(
      resolveLocaleChain({
        requested: undefined,
        defaultLocale: "en",
        configured,
      }),
    ).toEqual(["en"]);
    expect(
      resolveLocaleChain({ requested: null, defaultLocale: "en", configured }),
    ).toEqual(["en"]);
    expect(
      resolveLocaleChain({ requested: "", defaultLocale: "en", configured }),
    ).toEqual(["en"]);
  });

  it("fails instead of querying an unsupported default locale", () => {
    expect(() =>
      resolveLocaleChain({
        requested: "cs",
        defaultLocale: "en",
        configured: [],
      }),
    ).toThrow("is not in the configured locale list");
  });

  it("does not depend on a hardcoded language", () => {
    expect(
      resolveLocaleChain({
        requested: "xx-ZZ",
        defaultLocale: "pl",
        configured: ["pl"],
      }),
    ).toEqual(["pl"]);
  });

  it("adds the document source locale after a distinct default", () => {
    expect(
      resolveLocaleChain({
        requested: "fr-FR",
        defaultLocale: "en",
        sourceLocale: "cs",
        configured: ["cs", "en"],
      }),
    ).toEqual(["en", "cs"]);
  });

  it("rejects a source locale which Strapi does not have configured", () => {
    expect(() =>
      resolveLocaleChain({
        requested: "en",
        defaultLocale: "en",
        sourceLocale: "cs",
        configured: ["en"],
      }),
    ).toThrow("source locale cs is not in the configured locale list");
  });

  it("never yields duplicate attempts (each locale queried at most once)", () => {
    const out = resolveLocaleChain({
      requested: "cs",
      defaultLocale: "cs",
      configured,
    });
    expect(out).toEqual(["cs"]);
    expect(new Set(out).size).toBe(out.length);
  });
});
