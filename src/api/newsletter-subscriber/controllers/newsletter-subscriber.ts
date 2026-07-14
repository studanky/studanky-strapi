/**
 * newsletter-subscriber controller
 */

import { factories } from "@strapi/strapi";
import { createHmac } from "crypto";
import { createFixedWindowRateLimiter } from "../../../utils/fixed-window-rate-limit";
import { parseNewsletterSubscribeInput } from "../../../utils/newsletter";

const NEWSLETTER_SUBSCRIBER_UID =
  "api::newsletter-subscriber.newsletter-subscriber";
const DEFAULT_MAX_BODY_BYTES = 8 * 1024;
const DEFAULT_EMAIL_HOUR_LIMIT = 5;
const DEFAULT_EMAIL_DAY_LIMIT = 20;
const DEFAULT_RATE_LIMIT_MAX_KEYS = 10_000;

const positiveIntEnv = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const nonNegativeIntEnv = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

const MAX_BODY_BYTES = positiveIntEnv(
  "NEWSLETTER_SUBSCRIBE_MAX_BODY_BYTES",
  DEFAULT_MAX_BODY_BYTES
);
const RATE_LIMIT_SALT =
  process.env.NEWSLETTER_RATE_LIMIT_SALT ||
  process.env.ENCRYPTION_KEY ||
  process.env.APP_KEYS ||
  "newsletter-rate-limit";

const newsletterEmailLimiter = createFixedWindowRateLimiter(
  [
    {
      windowMs: 60 * 60 * 1000,
      max: nonNegativeIntEnv(
        "NEWSLETTER_EMAIL_RATE_LIMIT_HOUR_MAX",
        DEFAULT_EMAIL_HOUR_LIMIT
      ),
    },
    {
      windowMs: 24 * 60 * 60 * 1000,
      max: nonNegativeIntEnv(
        "NEWSLETTER_EMAIL_RATE_LIMIT_DAY_MAX",
        DEFAULT_EMAIL_DAY_LIMIT
      ),
    },
  ],
  {
    maxKeys: positiveIntEnv(
      "NEWSLETTER_RATE_LIMIT_MAX_KEYS",
      DEFAULT_RATE_LIMIT_MAX_KEYS
    ),
  }
);

const contentLengthTooLarge = (ctx): boolean => {
  const length = Number(ctx.get("content-length"));
  return Number.isFinite(length) && length > MAX_BODY_BYTES;
};

const parsedBodyTooLarge = (body: unknown): boolean => {
  try {
    return Buffer.byteLength(JSON.stringify(body ?? {}), "utf8") > MAX_BODY_BYTES;
  } catch {
    return true;
  }
};

const payloadTooLarge = (ctx) => {
  ctx.status = 413;
  return {
    data: null,
    error: {
      status: 413,
      name: "PayloadTooLargeError",
      message: "Newsletter payload too large",
      details: {},
    },
  };
};

const emailRateLimitKey = (emailNormalized: string) => {
  return createHmac("sha256", RATE_LIMIT_SALT)
    .update(emailNormalized)
    .digest("hex");
};

const tooManyRequests = (ctx, retryAfterSeconds: number) => {
  ctx.status = 429;
  ctx.set("Retry-After", String(retryAfterSeconds));
  return {
    data: null,
    error: {
      status: 429,
      name: "TooManyRequestsError",
      message: "Too many newsletter signup attempts",
      details: {},
    },
  };
};

export default factories.createCoreController(
  NEWSLETTER_SUBSCRIBER_UID,
  ({ strapi }) => ({
    /**
     * POST /api/newsletter/subscribe
     * Public, write-only newsletter signup. Returns a deliberately neutral
     * response so callers cannot enumerate stored email addresses.
     */
    async subscribe(ctx) {
      if (contentLengthTooLarge(ctx) || parsedBodyTooLarge(ctx.request.body)) {
        return payloadTooLarge(ctx);
      }

      const parsed = parseNewsletterSubscribeInput(
        ctx.request.body ?? {},
        new Date().toISOString()
      );

      if (parsed.type === "spam") {
        return { data: { ok: true } };
      }

      if (parsed.type === "invalid") {
        return ctx.badRequest(parsed.message);
      }

      const rateLimit = newsletterEmailLimiter.consume(
        emailRateLimitKey(parsed.data.email_normalized)
      );
      if (rateLimit.limited) {
        return tooManyRequests(ctx, rateLimit.retryAfterSeconds);
      }

      await strapi.service(NEWSLETTER_SUBSCRIBER_UID).subscribe(parsed.data);

      return { data: { ok: true } };
    },
  })
);
