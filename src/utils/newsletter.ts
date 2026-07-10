const DEFAULT_SOURCE = "website";
const DEFAULT_PREFERRED_LANGUAGE = "cs";
const EMAIL_MAX_LENGTH = 254;
const SOURCE_MAX_LENGTH = 80;
const PREFERRED_LANGUAGE_MAX_LENGTH = 32;
const CONSENT_VERSION_MAX_LENGTH = 80;
const SOURCE_URL_MAX_LENGTH = 2048;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PREFERRED_LANGUAGE_RE = /^[a-z]{2,3}(-[a-z0-9]{2,8}){0,2}$/;

type UnknownRecord = Record<string, unknown>;

export type NewsletterSubscriberState =
  | "pending"
  | "active"
  | "unsubscribed"
  | "bounced";

export interface NewsletterSubscribeData {
  email: string;
  email_normalized: string;
  state: "active";
  source: string;
  preferred_language: string;
  consented_at: string;
  last_subscribed_at: string;
  consent_version?: string | null;
  source_url?: string | null;
}

export interface ExistingNewsletterSubscriber {
  state?: NewsletterSubscriberState | null;
  consented_at?: string | null;
}

export type NewsletterSubscribeParseResult =
  | { type: "valid"; data: NewsletterSubscribeData }
  | { type: "spam" }
  | { type: "invalid"; message: string };

const isRecord = (value: unknown): value is UnknownRecord =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const optionalTrimmedString = (
  value: unknown,
  maxLength: number
): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.slice(0, maxLength);
};

export const normalizeNewsletterEmail = (value: unknown): string => {
  return optionalTrimmedString(value, EMAIL_MAX_LENGTH) ?? "";
};

export const isValidNewsletterEmail = (email: string): boolean => {
  return email.length > 0 && email.length <= EMAIL_MAX_LENGTH && EMAIL_RE.test(email);
};

export const normalizeNewsletterSource = (value: unknown): string => {
  const raw = optionalTrimmedString(value, SOURCE_MAX_LENGTH)?.toLowerCase();
  if (!raw) {
    return DEFAULT_SOURCE;
  }

  const normalized = raw
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");

  return normalized || DEFAULT_SOURCE;
};

export const normalizePreferredLanguage = (value: unknown): string => {
  const raw = optionalTrimmedString(value, PREFERRED_LANGUAGE_MAX_LENGTH)
    ?.toLowerCase()
    .replace("_", "-");

  if (!raw || !PREFERRED_LANGUAGE_RE.test(raw)) {
    return DEFAULT_PREFERRED_LANGUAGE;
  }

  return raw;
};

const normalizeSourceUrl = (
  value: unknown
): { value?: string | null; error?: string } => {
  const raw = optionalTrimmedString(value, SOURCE_URL_MAX_LENGTH);
  if (!raw) {
    return { value: null };
  }

  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { error: "sourceUrl must be an http(s) URL" };
    }
    return { value: url.toString().slice(0, SOURCE_URL_MAX_LENGTH) };
  } catch {
    return { error: "sourceUrl must be a valid URL" };
  }
};

export const parseNewsletterSubscribeInput = (
  input: unknown,
  now = new Date().toISOString()
): NewsletterSubscribeParseResult => {
  if (!isRecord(input)) {
    return { type: "invalid", message: "Request body must be an object" };
  }

  // Honeypot. Real users never fill this hidden field, simple bots often do.
  if (optionalTrimmedString(input.website, 200)) {
    return { type: "spam" };
  }

  if (input.consent !== true) {
    return { type: "invalid", message: "Consent is required" };
  }

  const email = normalizeNewsletterEmail(input.email);
  if (!isValidNewsletterEmail(email)) {
    return { type: "invalid", message: "Invalid email" };
  }

  const sourceUrl = normalizeSourceUrl(input.source_url ?? input.sourceUrl);
  if (sourceUrl.error) {
    return { type: "invalid", message: sourceUrl.error };
  }

  return {
    type: "valid",
    data: {
      email,
      email_normalized: email.toLowerCase(),
      state: "active",
      source: normalizeNewsletterSource(input.source),
      preferred_language: normalizePreferredLanguage(
        input.preferred_language ?? input.preferredLanguage
      ),
      consented_at: now,
      last_subscribed_at: now,
      consent_version:
        optionalTrimmedString(
          input.consent_version ?? input.consentVersion,
          CONSENT_VERSION_MAX_LENGTH
        ) ?? null,
      source_url: sourceUrl.value ?? null,
    },
  };
};

export const newsletterSubscriberDataForWrite = (
  data: NewsletterSubscribeData,
  existing?: ExistingNewsletterSubscriber | null
) => ({
  email: data.email,
  email_normalized: data.email_normalized,
  state: data.state,
  source: data.source,
  preferred_language: data.preferred_language,
  consented_at:
    existing?.state === "active" && existing.consented_at
      ? existing.consented_at
      : data.consented_at,
  last_subscribed_at: data.last_subscribed_at,
  unsubscribed_at: null,
  consent_version: data.consent_version ?? null,
  source_url: data.source_url ?? null,
});
