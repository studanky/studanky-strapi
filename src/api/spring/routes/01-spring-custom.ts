/**
 * Custom Spring routes.
 *
 * Prefixed `01-` so they load BEFORE the core router — otherwise `/springs/map`
 * would be swallowed by the core `/springs/:documentId` route (id = "map").
 *
 * `/sync-chmu` (admin-only) is added in a later step (ČHMÚ sync).
 */

export default {
  routes: [
    {
      method: "GET",
      path: "/springs/map",
      handler: "spring.map",
      config: { auth: false }, // public read
    },
    {
      method: "GET",
      path: "/springs/:documentId/reports",
      handler: "spring.reports",
      config: { auth: false }, // public read
    },
  ],
};
