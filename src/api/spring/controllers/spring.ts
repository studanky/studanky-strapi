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
}));
