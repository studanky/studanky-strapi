import { describe, it, expect } from "vitest";
import { resolvePreviewLocales } from "../../src/utils/locale";

const configured = ["cs", "en", "de"];

describe("resolvePreviewLocales", () => {
  it("tries the requested locale first, then the default, when both are configured and distinct", () => {
    expect(
      resolvePreviewLocales({ requested: "cs", defaultLocale: "en", configured })
    ).toEqual(["cs", "en"]);
  });

  it("collapses to a single attempt when requested === default", () => {
    expect(
      resolvePreviewLocales({ requested: "en", defaultLocale: "en", configured })
    ).toEqual(["en"]);
  });

  it("drops an unsupported (unconfigured) requested locale → default only", () => {
    // 'fr' is not configured → never queried, avoids depending on how the
    // Document Service reacts to an unknown locale.
    expect(
      resolvePreviewLocales({ requested: "fr", defaultLocale: "en", configured })
    ).toEqual(["en"]);
  });

  it("falls back to default when no locale is requested", () => {
    expect(
      resolvePreviewLocales({ requested: undefined, defaultLocale: "en", configured })
    ).toEqual(["en"]);
    expect(
      resolvePreviewLocales({ requested: null, defaultLocale: "en", configured })
    ).toEqual(["en"]);
    expect(
      resolvePreviewLocales({ requested: "", defaultLocale: "en", configured })
    ).toEqual(["en"]);
  });

  it("still returns the default even if the configured list is empty/misconfigured", () => {
    expect(
      resolvePreviewLocales({ requested: "cs", defaultLocale: "en", configured: [] })
    ).toEqual(["en"]);
  });

  it("never yields duplicate attempts (each locale queried at most once)", () => {
    const out = resolvePreviewLocales({
      requested: "cs",
      defaultLocale: "cs",
      configured,
    });
    expect(out).toEqual(["cs"]);
    expect(new Set(out).size).toBe(out.length);
  });
});
