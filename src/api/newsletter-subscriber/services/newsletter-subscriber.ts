/**
 * newsletter-subscriber service
 */

import { factories } from "@strapi/strapi";
import {
  newsletterSubscriberDataForWrite,
  type ExistingNewsletterSubscriber,
  type NewsletterSubscribeData,
} from "../../../utils/newsletter";

const NEWSLETTER_SUBSCRIBER_UID =
  "api::newsletter-subscriber.newsletter-subscriber";

interface NewsletterSubscriberRow extends ExistingNewsletterSubscriber {
  documentId: string;
}

const isDuplicateError = (error: unknown): boolean => {
  const err = error as { code?: string; errno?: number; message?: string };
  const message = err.message?.toLowerCase() ?? "";

  return (
    err.code === "23505" ||
    err.code === "SQLITE_CONSTRAINT" ||
    err.errno === 1062 ||
    message.includes("unique constraint") ||
    message.includes("duplicate key") ||
    message.includes("duplicate entry")
  );
};

export default factories.createCoreService(
  NEWSLETTER_SUBSCRIBER_UID,
  ({ strapi }) => ({
    /**
     * Public newsletter subscription is idempotent:
     * - new email -> create active subscriber,
     * - existing active email -> refresh last_subscribed_at,
     * - existing unsubscribed/bounced email + consent -> reactivate.
     */
    async subscribe(data: NewsletterSubscribeData) {
      const existing = (await strapi
        .documents(NEWSLETTER_SUBSCRIBER_UID)
        .findFirst({
          filters: { email_normalized: data.email_normalized },
          fields: ["state", "consented_at"],
        })) as NewsletterSubscriberRow | null;

      if (existing) {
        await strapi.documents(NEWSLETTER_SUBSCRIBER_UID).update({
          documentId: existing.documentId,
          data: newsletterSubscriberDataForWrite(data, existing),
        });

        return { created: false };
      }

      try {
        await strapi.documents(NEWSLETTER_SUBSCRIBER_UID).create({
          data: newsletterSubscriberDataForWrite(data),
        });
      } catch (error) {
        if (!isDuplicateError(error)) {
          throw error;
        }

        const duplicate = (await strapi
          .documents(NEWSLETTER_SUBSCRIBER_UID)
          .findFirst({
            filters: { email_normalized: data.email_normalized },
            fields: ["state", "consented_at"],
          })) as NewsletterSubscriberRow | null;

        if (!duplicate) {
          throw error;
        }

        await strapi.documents(NEWSLETTER_SUBSCRIBER_UID).update({
          documentId: duplicate.documentId,
          data: newsletterSubscriberDataForWrite(data, duplicate),
        });

        return { created: false };
      }

      return { created: true };
    },
  })
);
