import { describe, expect, it } from "vitest";
import {
  newsletterSubscriberDataForWrite,
  normalizeNewsletterEmail,
  normalizeNewsletterSource,
  normalizePreferredLanguage,
  parseNewsletterSubscribeInput,
} from "../../src/utils/newsletter";

describe("newsletter subscription helpers", () => {
  it("normalizes email, source and preferred language", () => {
    expect(normalizeNewsletterEmail("  User+Test@Example.COM  ")).toBe(
      "User+Test@Example.COM"
    );
    expect(normalizeNewsletterSource(" Website Footer ")).toBe(
      "website-footer"
    );
    expect(normalizePreferredLanguage("CS_CZ")).toBe("cs-cz");
  });

  it("parses a valid subscribe payload", () => {
    const result = parseNewsletterSubscribeInput(
      {
        email: "  User@Example.COM ",
        consent: true,
        source: "Launch Page",
        preferredLanguage: "EN",
        consentVersion: "2026-07-10",
        sourceUrl: "https://example.com/newsletter?ref=hero",
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
      source: "launch-page",
      preferred_language: "en",
      consented_at: "2026-07-10T12:00:00.000Z",
      last_subscribed_at: "2026-07-10T12:00:00.000Z",
      consent_version: "2026-07-10",
      source_url: "https://example.com/newsletter?ref=hero",
    });
  });

  it("rejects missing consent and invalid email", () => {
    expect(
      parseNewsletterSubscribeInput({ email: "user@example.com" }).type
    ).toBe("invalid");
    expect(
      parseNewsletterSubscribeInput({ email: "not-an-email", consent: true })
        .type
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
      { email: "user@example.com", consent: true },
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
});
