/**
 * spring service
 */

import { factories } from "@strapi/strapi";

const SPRING_UID = "api::spring.spring";
const REPORT_UID = "api::report.report";

type SpringStatus = "is_flowing" | "is_not_flowing" | "unknown";

interface LatestReport {
  is_flowing: boolean;
  flow_scale: number | null;
  flow_rate_lps: number | null;
  reported_at: string;
}

interface SpringStatusFields {
  documentId: string;
  current_status: SpringStatus;
  status_updated_at: string | null;
}

export default factories.createCoreService(SPRING_UID, ({ strapi }) => ({
  /**
   * Denormalization — the single source of truth for a Spring's cached status.
   *
   * Recomputes `current_status`, `status_updated_at`, `last_flow_scale` and
   * `last_flow_rate_lps` from the Spring's newest Report (by `reported_at`) and
   * writes them onto the Spring. Idempotent: always derives from the latest
   * report, so it is safe to call repeatedly / from multiple paths.
   *
   * Called explicitly by ČHMÚ sync and (Phase 2) report submit — NOT from a
   * lifecycle hook (invariant: denormalization happens only here).
   *
   * Spring keeps Draft & Publish, so the cached status must reach the PUBLISHED
   * row (the map reads published). We update published via `db.query()` to avoid
   * the Document Service syncing unrelated draft edits into published, and the
   * draft via the Document Service.
   */
  async refreshLatest(springDocumentId: string): Promise<void> {
    if (!springDocumentId) {
      return;
    }

    // 1) Newest report for this spring (newest-wins).
    const reports = (await strapi.documents(REPORT_UID).findMany({
      filters: { spring: { documentId: springDocumentId } },
      sort: { reported_at: "desc" },
      limit: 1,
      fields: ["is_flowing", "flow_scale", "flow_rate_lps", "reported_at"],
    })) as unknown as LatestReport[];

    const latest = reports[0];
    if (!latest) {
      // No reports yet → nothing to denormalize.
      return;
    }

    const newStatus: SpringStatus = latest.is_flowing
      ? "is_flowing"
      : "is_not_flowing";

    const data = {
      current_status: newStatus,
      status_updated_at: latest.reported_at,
      last_flow_scale: latest.flow_scale ?? null,
      last_flow_rate_lps: latest.flow_rate_lps ?? null,
    };

    // 2) Is there a published version?
    const published = (await strapi.documents(SPRING_UID).findOne({
      documentId: springDocumentId,
      status: "published",
      fields: ["current_status", "status_updated_at"],
    })) as SpringStatusFields | null;

    if (!published) {
      // Draft only → update draft via Document Service.
      await strapi.documents(SPRING_UID).update({
        documentId: springDocumentId,
        data,
      });
      strapi.log.debug(
        `refreshLatest: Spring ${springDocumentId} draft → ${newStatus} (not published)`
      );
      return;
    }

    // 3a) Published row → write directly via db.query to bypass draft sync.
    await strapi.db.query(SPRING_UID).updateMany({
      where: {
        documentId: springDocumentId,
        publishedAt: { $notNull: true },
      },
      data: {
        ...data,
        updatedAt: new Date().toISOString(),
      },
    });

    // 3b) Draft row → Document Service (preserves other uncommitted draft edits).
    await strapi.documents(SPRING_UID).update({
      documentId: springDocumentId,
      data,
    });

    strapi.log.debug(
      `refreshLatest: Spring ${springDocumentId} draft+published → ${newStatus}`
    );
  },

  /**
   * Map query — returns only the minimal PUBLIC fields needed to render markers
   * within a bounding box. No report history, no private data. Reads the
   * published, default-locale (cs) rows so the hot map path stays cheap.
   *
   * @param bbox "minLng,minLat,maxLng,maxLat"
   */
  async findInBbox(bbox: string | undefined) {
    if (!bbox || typeof bbox !== "string") {
      return [];
    }
    const [minLng, minLat, maxLng, maxLat] = bbox.split(",").map(Number);
    if ([minLng, minLat, maxLng, maxLat].some((n) => Number.isNaN(n))) {
      return [];
    }

    return strapi.documents(SPRING_UID).findMany({
      filters: {
        lat: { $gte: minLat, $lte: maxLat },
        lng: { $gte: minLng, $lte: maxLng },
      },
      // Only map-safe fields (documentId is always included by the Document Service).
      fields: ["name", "lat", "lng", "current_status", "status_updated_at"],
      status: "published",
      locale: "cs",
    });
  },

  /**
   * Paginated report history for a Spring (lazy-loaded detail view).
   *
   * Returns an explicit PUBLIC field allowlist — private capture data
   * (`user_lat`, `user_lng`) and internal `device_id` are never fetched, so
   * they cannot leak regardless of controller-level sanitization.
   */
  async history(documentId: string, page = 1, pageSize = 20) {
    const safePage = Math.max(1, page);
    const safePageSize = Math.min(Math.max(1, pageSize), 100);
    const start = (safePage - 1) * safePageSize;
    const filters = { spring: { documentId } };

    const [data, total] = await Promise.all([
      strapi.documents(REPORT_UID).findMany({
        filters,
        sort: { reported_at: "desc" },
        start,
        limit: safePageSize,
        fields: [
          "is_flowing",
          "flow_scale",
          "flow_rate_lps",
          "has_odor",
          "water_clarity",
          "note",
          "reported_at",
        ],
      }),
      strapi.documents(REPORT_UID).count({ filters }),
    ]);

    return {
      data,
      pagination: {
        page: safePage,
        pageSize: safePageSize,
        total,
        pageCount: Math.ceil(total / safePageSize),
      },
    };
  },
}));
