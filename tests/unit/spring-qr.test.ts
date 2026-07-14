import { describe, it, expect } from "vitest";
import { shouldGenerateQr } from "../../src/api/spring/content-types/spring/lifecycles";

describe("shouldGenerateQr", () => {
  it("generates on a genuine draft creation with no QR yet", () => {
    expect(shouldGenerateQr({ publishedAt: null, hasExistingQr: false })).toBe(
      true
    );
    expect(
      shouldGenerateQr({ publishedAt: undefined, hasExistingQr: false })
    ).toBe(true);
  });

  it("skips the published-row clone (publish / nightly re-publish)", () => {
    // publish() creates a published row whose create data carries publishedAt.
    expect(
      shouldGenerateQr({ publishedAt: new Date(), hasExistingQr: false })
    ).toBe(false);
    // publishedAt wins even if the document has no QR yet.
    expect(
      shouldGenerateQr({
        publishedAt: "2026-01-01T00:00:00.000Z",
        hasExistingQr: false,
      })
    ).toBe(false);
  });

  it("is idempotent — skips when the document already has a QR", () => {
    // e.g. discardDraft re-creates the draft row, cloning qr_code from published.
    expect(shouldGenerateQr({ publishedAt: null, hasExistingQr: true })).toBe(
      false
    );
  });
});
