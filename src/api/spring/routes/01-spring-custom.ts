/**
 * Custom Spring routes.
 *
 * Prefixed `01-` so they load BEFORE the core router — otherwise `/springs/map`
 * would be swallowed by the core `/springs/:documentId` route (id = "map").
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
      path: "/springs/search",
      handler: "spring.search",
      config: { auth: false }, // public read
    },
    {
      method: "GET",
      path: "/springs/:documentId/reports",
      handler: "spring.reports",
      config: { auth: false }, // public read
    },
    {
      method: "GET",
      path: "/springs/:documentId/preview",
      handler: "spring.preview",
      config: { auth: false }, // public read — web share/preview page
    },
    {
      method: "POST",
      path: "/springs/sync-chmu",
      handler: "spring.syncChmu",
      // Authenticated (NO auth:false): call with an admin API token. Ops-only.
    },
  ],
};
