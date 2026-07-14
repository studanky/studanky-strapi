const EMAIL_MAX_LENGTH = 254;
const SOURCE_MAX_LENGTH = 80;
const PREFERRED_LANGUAGE_MAX_LENGTH = 32;
const CONSENT_VERSION_MAX_LENGTH = 80;
const SOURCE_REFERENCE_MAX_LENGTH = 2048;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOCALE_TAG_RE = /^[a-z]{2,3}(-[a-z0-9]{2,8}){0,3}$/i;

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
  source?: string;
  preferred_language?: string;
  consented_at: string;
  last_subscribed_at: string;
  consent_version?: string | null;
  source_ref?: string | null;
}

export interface ExistingNewsletterSubscriber {
  state?: NewsletterSubscriberState | null;
  consented_at?: string | null;
}

export interface NewsletterSubscriberWriteData {
  email: string;
  email_normalized: string;
  state: "active";
  source?: string | null;
  preferred_language?: string | null;
  consented_at: string;
  last_subscribed_at: string;
  unsubscribed_at: null;
  consent_version?: string | null;
  source_ref?: string | null;
}

export type NewsletterSubscribeParseResult =
  | { type: "valid"; data: NewsletterSubscribeData }
  | { type: "spam" }
  | { type: "invalid"; message: string };

const isRecord = (value: unknown): value is UnknownRecord =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const optionalTrimmedString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed;
};

const trimmedStringTooLong = (value: unknown, maxLength: number): boolean => {
  const trimmed = optionalTrimmedString(value);
  return trimmed != null && trimmed.length > maxLength;
};

export const normalizeNewsletterEmail = (value: unknown): string => {
  return optionalTrimmedString(value) ?? "";
};

export const isValidNewsletterEmail = (email: string): boolean => {
  return email.length > 0 && email.length <= EMAIL_MAX_LENGTH && EMAIL_RE.test(email);
};

export const normalizeNewsletterSource = (value: unknown): string => {
  return optionalTrimmedString(value) ?? "";
};

export const normalizePreferredLanguage = (value: unknown): string => {
  const raw = optionalTrimmedString(value)?.replace(/_/g, "-");
  if (!raw) {
    return "";
  }

  return raw
    .split("-")
    .map((part, index) => {
      if (index === 0) {
        return part.toLowerCase();
      }
      if (part.length === 2 || /^\d{3}$/.test(part)) {
        return part.toUpperCase();
      }
      if (part.length === 4) {
        return part[0].toUpperCase() + part.slice(1).toLowerCase();
      }
      return part.toLowerCase();
    })
    .join("-");
};

export const isValidPreferredLanguage = (value: string): boolean => {
  return value.length > 0 && LOCALE_TAG_RE.test(value);
};

export const normalizeNewsletterSourceReference = (value: unknown): string => {
  return optionalTrimmedString(value) ?? "";
};

export const parseNewsletterSubscribeInput = (
  input: unknown,
  now = new Date().toISOString()
): NewsletterSubscribeParseResult => {
  if (!isRecord(input)) {
    return { type: "invalid", message: "Request body must be an object" };
  }

  // Honeypot. Real users never fill this hidden field, simple bots often do.
  if (optionalTrimmedString(input.website)) {
    return { type: "spam" };
  }

  if (input.consent !== true) {
    return { type: "invalid", message: "Consent is required" };
  }

  const email = normalizeNewsletterEmail(input.email);
  if (!isValidNewsletterEmail(email)) {
    return { type: "invalid", message: "Invalid email" };
  }

  if (trimmedStringTooLong(input.source, SOURCE_MAX_LENGTH)) {
    return { type: "invalid", message: "source is too long" };
  }
  const source = normalizeNewsletterSource(input.source);

  if (
    trimmedStringTooLong(input.preferredLanguage, PREFERRED_LANGUAGE_MAX_LENGTH)
  ) {
    return { type: "invalid", message: "preferredLanguage is too long" };
  }
  const preferredLanguageRaw = optionalTrimmedString(
    input.preferredLanguage
  );
  const preferredLanguage = normalizePreferredLanguage(
    preferredLanguageRaw
  );
  if (preferredLanguageRaw != null && !isValidPreferredLanguage(preferredLanguage)) {
    return { type: "invalid", message: "Invalid preferredLanguage" };
  }

  if (trimmedStringTooLong(input.sourceRef, SOURCE_REFERENCE_MAX_LENGTH)) {
    return { type: "invalid", message: "sourceRef is too long" };
  }
  const sourceReference = normalizeNewsletterSourceReference(input.sourceRef);

  if (trimmedStringTooLong(input.consentVersion, CONSENT_VERSION_MAX_LENGTH)) {
    return { type: "invalid", message: "consentVersion is too long" };
  }
  const consentVersion = optionalTrimmedString(input.consentVersion);

  return {
    type: "valid",
    data: {
      email,
      email_normalized: email.toLowerCase(),
      state: "active",
      ...(source ? { source } : {}),
      ...(preferredLanguage ? { preferred_language: preferredLanguage } : {}),
      consented_at: now,
      last_subscribed_at: now,
      ...(consentVersion ? { consent_version: consentVersion } : {}),
      ...(sourceReference ? { source_ref: sourceReference } : {}),
    },
  };
};

export const newsletterSubscriberDataForWrite = (
  data: NewsletterSubscribeData,
  existing?: ExistingNewsletterSubscriber | null
): NewsletterSubscriberWriteData => {
  const isReactivation =
    existing?.state != null && existing.state !== "active";
  const writeData: NewsletterSubscriberWriteData = {
    email: data.email,
    email_normalized: data.email_normalized,
    state: data.state,
    consented_at:
      existing?.state === "active" && existing.consented_at
        ? existing.consented_at
        : data.consented_at,
    last_subscribed_at: data.last_subscribed_at,
    unsubscribed_at: null,
  };

  if (data.source !== undefined) {
    writeData.source = data.source;
  } else if (isReactivation) {
    writeData.source = null;
  }
  if (data.preferred_language !== undefined) {
    writeData.preferred_language = data.preferred_language;
  } else if (isReactivation) {
    writeData.preferred_language = null;
  }
  if (data.consent_version !== undefined) {
    writeData.consent_version = data.consent_version;
  } else if (isReactivation) {
    writeData.consent_version = null;
  }
  if (data.source_ref !== undefined) {
    writeData.source_ref = data.source_ref;
  } else if (isReactivation) {
    writeData.source_ref = null;
  }

  return writeData;
};
