import { describe, it, expect } from "vitest";
import {
  findConfiguredLocale,
  indexConfiguredLocales,
  resolveLocaleChain,
} from "../../src/utils/locale";

const configuredByCanonical = indexConfiguredLocales([
  "cs",
  "en",
  "en-US",
  "de",
]);

describe("resolveLocaleChain", () => {
  it("tries the requested locale first, then the default, when both are configured and distinct", () => {
    expect(
      resolveLocaleChain({
        requested: "cs",
        defaultLocale: "en",
        configuredByCanonical,
      }),
    ).toEqual(["cs", "en"]);
  });

  it("normalizes separators and casing while preserving configured codes", () => {
    expect(
      resolveLocaleChain({
        requested: "EN_us",
        defaultLocale: "cs",
        configuredByCanonical,
      }),
    ).toEqual(["en-US", "en", "cs"]);
  });

  it("shares a prebuilt configured index between chain and direct lookups", () => {
    const regionalIndex = indexConfiguredLocales(["cs", "en_US"]);

    expect(
      resolveLocaleChain({
        requested: "EN-us",
        defaultLocale: "cs",
        configuredByCanonical: regionalIndex,
      }),
    ).toEqual(["en_US", "cs"]);
    expect(findConfiguredLocale("en-US", regionalIndex)).toBe("en_US");
  });

  it("rejects invalid configured tags while building the shared index", () => {
    expect(() => indexConfiguredLocales(["cs", "not-a-locale!"])).toThrow(
      "Strapi i18n locale not-a-locale! is invalid",
    );
  });

  it("falls back from an unavailable regional locale to its base and configured siblings", () => {
    expect(
      resolveLocaleChain({
        requested: "en-GB",
        defaultLocale: "cs",
        configuredByCanonical,
      }),
    ).toEqual(["en", "en-US", "cs"]);
  });

  it("uses a preferred same-language variant before a different-language default", () => {
    expect(
      resolveLocaleChain({
        requested: "en-AU",
        defaultLocale: "cs",
        configuredByCanonical: indexConfiguredLocales([
          "cs",
          "en-US",
          "en-GB",
        ]),
        preferredVariants: { en: ["en-US", "en-GB"] },
      }),
    ).toEqual(["en-US", "en-GB", "cs"]);
  });

  it("accepts a base client tag and negotiates a configured regional variant", () => {
    expect(
      resolveLocaleChain({
        requested: "en",
        defaultLocale: "cs",
        configuredByCanonical: indexConfiguredLocales(["cs", "en-US"]),
      }),
    ).toEqual(["en-US", "cs"]);
  });

  it("preserves script-aware parent fallback", () => {
    expect(
      resolveLocaleChain({
        requested: "sr-Latn-RS",
        defaultLocale: "cs",
        configuredByCanonical: indexConfiguredLocales([
          "cs",
          "sr",
          "sr-Latn",
          "sr-Cyrl",
        ]),
      }),
    ).toEqual(["sr-Latn", "sr", "sr-Cyrl", "cs"]);
  });

  it("deduplicates requested/default while retaining another same-language variant", () => {
    expect(
      resolveLocaleChain({
        requested: "en",
        defaultLocale: "en",
        configuredByCanonical,
      }),
    ).toEqual(["en", "en-US"]);
  });

  it("drops an unsupported (unconfigured) requested locale → default only", () => {
    // 'fr' is not configured → never queried, avoids depending on how the
    // Document Service reacts to an unknown locale.
    expect(
      resolveLocaleChain({
        requested: "fr",
        defaultLocale: "en",
        configuredByCanonical,
      }),
    ).toEqual(["en"]);
  });

  it("falls back to default when no locale is requested", () => {
    expect(
      resolveLocaleChain({
        requested: undefined,
        defaultLocale: "en",
        configuredByCanonical,
      }),
    ).toEqual(["en"]);
    expect(
      resolveLocaleChain({
        requested: null,
        defaultLocale: "en",
        configuredByCanonical,
      }),
    ).toEqual(["en"]);
    expect(
      resolveLocaleChain({
        requested: "",
        defaultLocale: "en",
        configuredByCanonical,
      }),
    ).toEqual(["en"]);
  });

  it("fails instead of querying an unsupported default locale", () => {
    expect(() =>
      resolveLocaleChain({
        requested: "cs",
        defaultLocale: "en",
        configuredByCanonical: indexConfiguredLocales([]),
      }),
    ).toThrow("is not in the configured locale list");
  });

  it("does not depend on a hardcoded language", () => {
    expect(
      resolveLocaleChain({
        requested: "xx-ZZ",
        defaultLocale: "pl",
        configuredByCanonical: indexConfiguredLocales(["pl"]),
      }),
    ).toEqual(["pl"]);
  });

  it("never yields duplicate attempts (each locale queried at most once)", () => {
    const out = resolveLocaleChain({
      requested: "cs",
      defaultLocale: "cs",
      configuredByCanonical,
    });
    expect(out).toEqual(["cs"]);
    expect(new Set(out).size).toBe(out.length);
  });
});
