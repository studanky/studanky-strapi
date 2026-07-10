/**
 * Custom newsletter routes.
 *
 * Public write surface is intentionally a single explicit endpoint. Core CRUD
 * routes are disabled in `newsletter-subscriber.ts`.
 */

export default {
  routes: [
    {
      method: "POST",
      path: "/newsletter/subscribe",
      handler: "api::newsletter-subscriber.newsletter-subscriber.subscribe",
      config: { auth: false },
    },
  ],
};
