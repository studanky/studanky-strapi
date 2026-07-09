/**
 * spring controller
 */

import { factories } from "@strapi/strapi";

const SPRING_UID = "api::spring.spring";

export default factories.createCoreController(SPRING_UID, ({ strapi }) => ({
  /**
   * GET /api/springs/map?bbox=minLng,minLat,maxLng,maxLat
   * Minimal public payload for the map. Logic lives in the service.
   */
  async map(ctx) {
    await this.validateQuery(ctx);

    const { bbox } = ctx.query;
    if (!bbox || typeof bbox !== "string") {
      return ctx.badRequest(
        'Missing or invalid "bbox" query (expected "minLng,minLat,maxLng,maxLat")'
      );
    }

    const points = await strapi.service(SPRING_UID).findInBbox(bbox);
    return { data: points };
  },

  /**
   * GET /api/springs/search?q=&lat=&lng=&limit=&locale=
   * Name autocomplete for the map search box. Returns map-safe fields so a
   * picked result can fly the map to its coordinates. With a valid lat/lng
   * origin, results are nearest-first (+ `distance_m`). Logic lives in the
   * service.
   */
  async search(ctx) {
    await this.validateQuery(ctx);

    const { q, lat, lng, limit, locale } = ctx.query;
    if (!q || typeof q !== "string" || q.trim().length < 2) {
      return ctx.badRequest(
        'Missing or too short "q" query (minimum 2 characters)'
      );
    }

    const data = await strapi.service(SPRING_UID).search({
      q,
      lat: lat != null ? Number(lat) : undefined,
      lng: lng != null ? Number(lng) : undefined,
      limit: limit != null ? Number(limit) : undefined,
      locale: typeof locale === "string" ? locale : undefined,
    });

    return { data };
  },

  /**
   * GET /api/springs/:documentId/reports?page=&pageSize=
   * Paginated, public report history (private fields never fetched).
   */
  async reports(ctx) {
    await this.validateQuery(ctx);

    const { documentId } = ctx.params;
    const { page, pageSize } = ctx.query;

    const result = await strapi
      .service(SPRING_UID)
      .history(documentId, Number(page) || 1, Number(pageSize) || 20);

    return { data: result.data, meta: { pagination: result.pagination } };
  },

  /**
   * GET /api/springs/:documentId/preview?locale=
   * Minimal public "share" payload for the web preview page (deep-link fallback
   * when the recipient has no app). Teaser fields only — flow strength and
   * report history are intentionally withheld. Logic lives in the service.
   */
  async preview(ctx) {
    await this.validateQuery(ctx);

    const { documentId } = ctx.params;
    const { locale } = ctx.query;

    const data = await strapi
      .service(SPRING_UID)
      .preview(documentId, typeof locale === "string" ? locale : undefined);

    if (!data) {
      return ctx.notFound("Spring not found");
    }

    return { data };
  },

  /**
   * POST /api/springs/sync-chmu
   * Manual trigger for the ČHMÚ sync (ops). Authenticated — call with an admin
   * API token; the scheduled cron uses the same service.
   */
  async syncChmu(ctx) {
    const stats = await strapi.service(SPRING_UID).syncFromChmu();
    return { data: stats };
  },
}));
