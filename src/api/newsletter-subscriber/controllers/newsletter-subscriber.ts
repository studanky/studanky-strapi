/**
 * newsletter-subscriber controller
 */

import { factories } from "@strapi/strapi";
import { parseNewsletterSubscribeInput } from "../../../utils/newsletter";

const NEWSLETTER_SUBSCRIBER_UID =
  "api::newsletter-subscriber.newsletter-subscriber";

const bodyInput = (body: unknown): unknown => {
  if (
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    "data" in body &&
    (body as { data?: unknown }).data &&
    typeof (body as { data?: unknown }).data === "object" &&
    !Array.isArray((body as { data?: unknown }).data)
  ) {
    return (body as { data: unknown }).data;
  }

  return body;
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
      const parsed = parseNewsletterSubscribeInput(
        bodyInput(ctx.request.body ?? {})
      );

      if (parsed.type === "spam") {
        return { data: { ok: true } };
      }

      if (parsed.type === "invalid") {
        return ctx.badRequest(parsed.message);
      }

      await strapi.service(NEWSLETTER_SUBSCRIBER_UID).subscribe(parsed.data);

      return { data: { ok: true } };
    },
  })
);
