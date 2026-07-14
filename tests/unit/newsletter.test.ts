import { describe, expect, it } from "vitest";
import {
  isValidPreferredLanguage,
  newsletterSubscriberDataForWrite,
  normalizeNewsletterEmail,
  normalizeNewsletterSource,
  normalizeNewsletterSourceReference,
  normalizePreferredLanguage,
  parseNewsletterSubscribeInput,
} from "../../src/utils/newsletter";

describe("newsletter subscription helpers", () => {
  it("normalizes email, trims source and normalizes preferred language", () => {
    expect(normalizeNewsletterEmail("  User+Test@Example.COM  ")).toBe(
      "User+Test@Example.COM"
    );
    expect(normalizeNewsletterSource(" Website Footer ")).toBe(
      "Website Footer"
    );
    expect(normalizeNewsletterSourceReference(" /newsletter?ref=hero ")).toBe(
      "/newsletter?ref=hero"
    );
    expect(normalizePreferredLanguage("CS_CZ")).toBe("cs-CZ");
    expect(isValidPreferredLanguage("cs")).toBe(true);
    expect(isValidPreferredLanguage("en-US")).toBe(true);
    expect(isValidPreferredLanguage("de")).toBe(true);
  });

  it("parses a valid subscribe payload", () => {
    const result = parseNewsletterSubscribeInput(
      {
        email: "  User@Example.COM ",
        consent: true,
        source: "Website Footer",
        preferredLanguage: "EN",
        consentVersion: "2026-07-10",
        sourceRef: "https://example.com/newsletter?ref=hero",
      },
      "2026-07-10T12:00:00.000Z"
    );

    expect(result.type).toBe("valid");
    if (result.type !== "valid") {
      return;
    }

    expect(result.data).toEqual({
      email: "User@Example.COM",
      email_normalized: "user@example.com",
      state: "active",
      source: "Website Footer",
      preferred_language: "en",
      consented_at: "2026-07-10T12:00:00.000Z",
      last_subscribed_at: "2026-07-10T12:00:00.000Z",
      consent_version: "2026-07-10",
      source_ref: "https://example.com/newsletter?ref=hero",
    });
  });

  it("rejects missing consent and invalid email", () => {
    expect(
      parseNewsletterSubscribeInput({
        email: "user@example.com",
        source: "website-footer",
        preferredLanguage: "cs",
      }).type
    ).toBe("invalid");
    expect(
      parseNewsletterSubscribeInput({
        email: "not-an-email",
        consent: true,
        source: "website-footer",
        preferredLanguage: "cs",
      }).type
    ).toBe("invalid");
  });

  it("does not require optional source or preferred language", () => {
    const result = parseNewsletterSubscribeInput(
      {
        email: "user@example.com",
        consent: true,
      },
      "2026-07-10T12:00:00.000Z"
    );

    expect(result.type).toBe("valid");
    if (result.type !== "valid") {
      return;
    }

    expect(result.data).not.toHaveProperty("source");
    expect(result.data).not.toHaveProperty("preferred_language");
    expect(newsletterSubscriberDataForWrite(result.data)).not.toHaveProperty(
      "source"
    );
    expect(newsletterSubscriberDataForWrite(result.data)).not.toHaveProperty(
      "preferred_language"
    );
  });

  it("treats blank optional metadata as absent", () => {
    const result = parseNewsletterSubscribeInput(
      {
        email: "user@example.com",
        consent: true,
        source: " ",
        preferredLanguage: "",
        consentVersion: " ",
        sourceRef: "",
      },
      "2026-07-10T12:00:00.000Z"
    );

    expect(result.type).toBe("valid");
    if (result.type !== "valid") {
      return;
    }

    expect(result.data).not.toHaveProperty("source");
    expect(result.data).not.toHaveProperty("preferred_language");
    expect(result.data).not.toHaveProperty("consent_version");
    expect(result.data).not.toHaveProperty("source_ref");
  });

  it("accepts source reference paths and non-url values", () => {
    const relativePath = parseNewsletterSubscribeInput(
      {
        email: "user@example.com",
        consent: true,
        sourceRef: "/newsletter?ref=footer",
      },
      "2026-07-10T12:00:00.000Z"
    );
    expect(relativePath.type).toBe("valid");
    if (relativePath.type === "valid") {
      expect(relativePath.data.source_ref).toBe("/newsletter?ref=footer");
    }

    const mobileApp = parseNewsletterSubscribeInput(
      {
        email: "user@example.com",
        consent: true,
        sourceRef: "mobile-app:ios:prelaunch",
      },
      "2026-07-10T12:00:00.000Z"
    );
    expect(mobileApp.type).toBe("valid");
    if (mobileApp.type === "valid") {
      expect(mobileApp.data.source_ref).toBe("mobile-app:ios:prelaunch");
    }
  });

  it("rejects malformed language", () => {
    expect(
      parseNewsletterSubscribeInput({
        email: "user@example.com",
        consent: true,
        source: "website-footer",
        preferredLanguage: "not a locale",
      }).type
    ).toBe("invalid");
  });

  it("rejects overlong fields instead of truncating them", () => {
    const overlongEmail = `${"a".repeat(250)}@example.com`;
    expect(
      parseNewsletterSubscribeInput({
        email: overlongEmail,
        consent: true,
      }).type
    ).toBe("invalid");

    expect(
      parseNewsletterSubscribeInput({
        email: "user@example.com",
        consent: true,
        source: "x".repeat(81),
      }).type
    ).toBe("invalid");

    expect(
      parseNewsletterSubscribeInput({
        email: "user@example.com",
        consent: true,
        preferredLanguage: "x".repeat(33),
      }).type
    ).toBe("invalid");

    expect(
      parseNewsletterSubscribeInput({
        email: "user@example.com",
        consent: true,
        consentVersion: "x".repeat(81),
      }).type
    ).toBe("invalid");

    expect(
      parseNewsletterSubscribeInput({
        email: "user@example.com",
        consent: true,
        sourceRef: "x".repeat(2049),
      }).type
    ).toBe("invalid");
  });

  it("flags honeypot submissions without validating the rest", () => {
    expect(
      parseNewsletterSubscribeInput({
        email: "not-an-email",
        consent: false,
        website: "https://bot.example",
      }).type
    ).toBe("spam");
  });

  it("builds idempotent write data and preserves active consent time", () => {
    const result = parseNewsletterSubscribeInput(
      {
        email: "user@example.com",
        consent: true,
        source: "website-footer",
        preferredLanguage: "cs",
      },
      "2026-07-10T12:00:00.000Z"
    );

    expect(result.type).toBe("valid");
    if (result.type !== "valid") {
      return;
    }

    expect(
      newsletterSubscriberDataForWrite(result.data, {
        state: "active",
        consented_at: "2026-07-01T12:00:00.000Z",
      })
    ).toMatchObject({
      state: "active",
      consented_at: "2026-07-01T12:00:00.000Z",
      last_subscribed_at: "2026-07-10T12:00:00.000Z",
      unsubscribed_at: null,
    });

    expect(
      newsletterSubscriberDataForWrite(result.data, {
        state: "unsubscribed",
        consented_at: "2026-07-01T12:00:00.000Z",
      })
    ).toMatchObject({
      state: "active",
      consented_at: "2026-07-10T12:00:00.000Z",
      unsubscribed_at: null,
    });
  });

  it("preserves optional metadata for active duplicates but clears it on reactivation when omitted", () => {
    const result = parseNewsletterSubscribeInput(
      {
        email: "user@example.com",
        consent: true,
      },
      "2026-07-10T12:00:00.000Z"
    );

    expect(result.type).toBe("valid");
    if (result.type !== "valid") {
      return;
    }

    const activeWrite = newsletterSubscriberDataForWrite(result.data, {
      state: "active",
      consented_at: "2026-07-01T12:00:00.000Z",
    });
    expect(activeWrite).not.toHaveProperty("source");
    expect(activeWrite).not.toHaveProperty("preferred_language");
    expect(activeWrite).not.toHaveProperty("consent_version");
    expect(activeWrite).not.toHaveProperty("source_ref");

    const reactivationWrite = newsletterSubscriberDataForWrite(result.data, {
      state: "unsubscribed",
      consented_at: "2026-07-01T12:00:00.000Z",
    });
    expect(reactivationWrite).toMatchObject({
      consented_at: "2026-07-10T12:00:00.000Z",
      source: null,
      preferred_language: null,
      consent_version: null,
      source_ref: null,
    });
  });
});
