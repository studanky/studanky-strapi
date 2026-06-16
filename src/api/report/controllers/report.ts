/**
 * report controller
 */

import { factories } from "@strapi/strapi";

const REPORT_UID = "api::report.report";

export default factories.createCoreController(REPORT_UID, () => ({
  /**
   * Public/client-created reports are always user-sourced. Ignore any
   * client-supplied `source_type` so callers cannot spoof ČHMÚ records.
   */
  async create(ctx) {
    const body = (ctx.request.body ?? {}) as { data?: unknown };
    const inputData =
      body.data && typeof body.data === "object" && !Array.isArray(body.data)
        ? { ...(body.data as Record<string, unknown>) }
        : {};

    delete inputData.source_type;

    ctx.request.body = {
      ...body,
      data: {
        ...inputData,
        source_type: "user",
      },
    };

    return super.create(ctx);
  },
}));
