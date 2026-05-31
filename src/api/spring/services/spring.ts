/**
 * spring service
 */

import { factories } from "@strapi/strapi";
import type { Core } from "@strapi/strapi";
import {
  listSpringStations,
  fetchLatestValue,
  fetchRecentValue,
  recentMonths,
} from "./chmu-client";
import { mapWithConcurrency } from "../../../utils/concurrency";

const SPRING_UID = "api::spring.spring";
const REPORT_UID = "api::report.report";
const CONFIG_UID = "api::platform-config.platform-config";
const CHMU_SOURCE = "chmu";

type SpringStatus = "is_flowing" | "is_not_flowing" | "unknown";

interface LatestReport {
  is_flowing: boolean;
  flow_scale: number | null;
  flow_rate_lps: number | null;
  reported_at: string;
}

/** Resolves the configured default locale dynamically (falls back to en). */
async function getDefaultLocale(strapi: Core.Strapi): Promise<string> {
  try {
    const code = await strapi
      .plugin("i18n")
      .service("locales")
      .getDefaultLocale();
    return code || "en";
  } catch {
    return "en";
  }
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
   * Spring keeps Draft & Publish (the map reads the published row). We write the
   * draft AND published rows in one raw `db.query` update with the same
   * `updatedAt`, so both rows stay identical → the entry remains "Published"
   * (no spurious "Modified" badge). Using `db.query` also bypasses the Document
   * Service, so unrelated uncommitted draft edits to OTHER fields are preserved
   * and never auto-published.
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

    // 2) Update BOTH the draft and published rows in a single raw update with
    //    the same updatedAt → rows stay in sync, entry stays "Published".
    await strapi.db.query(SPRING_UID).updateMany({
      where: { documentId: springDocumentId },
      data: { ...data, updatedAt: new Date().toISOString() },
    });

    strapi.log.debug(
      `refreshLatest: Spring ${springDocumentId} → ${newStatus} (draft+published)`
    );
  },

  /**
   * Map query — returns only the minimal PUBLIC fields needed to render markers
   * within a bounding box. No report history, no private data. Reads the
   * published, default-locale rows so the hot map path stays cheap.
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

    const locale = await getDefaultLocale(strapi);
    return strapi.documents(SPRING_UID).findMany({
      filters: {
        lat: { $gte: minLat, $lte: maxLat },
        lng: { $gte: minLng, $lte: maxLng },
      },
      // Only map-safe fields (documentId is always included by the Document Service).
      fields: ["name", "lat", "lng", "current_status", "status_updated_at"],
      status: "published",
      locale,
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

  /**
   * ČHMÚ sync — upserts spring stations and appends a fresh discharge report
   * when ČHMÚ has newer data, then denormalizes via refreshLatest.
   *
   * Source-neutral: the ČHMÚ adapter (`chmu-client`) yields neutral DTOs; this
   * method maps them onto the canonical model (external_source = 'chmu'). Each
   * station is isolated in try/catch so one bad object never aborts the run;
   * value downloads are concurrency-limited (~hundreds of files / night).
   */
  async syncFromChmu() {
    const locale = await getDefaultLocale(strapi);
    const stations = await listSpringStations();

    const stats = {
      stations: stations.length,
      created: 0,
      updated: 0,
      reports: 0,
      recent: 0, // values that came from the recent/ fallback (not now/)
      skipped: 0,
      errors: 0,
    };

    // Phase A — upsert station metadata (sequential; SQLite-friendly writes).
    const targets: Array<{
      documentId: string;
      externalId: string;
      lastReportAt: string | null;
    }> = [];

    for (const st of stations) {
      try {
        const existing = (await strapi.documents(SPRING_UID).findFirst({
          filters: { external_source: CHMU_SOURCE, external_id: st.externalId },
          status: "draft",
          locale,
          fields: ["status_updated_at"],
        })) as { documentId: string; status_updated_at: string | null } | null;

        if (!existing) {
          const created = await strapi.documents(SPRING_UID).create({
            data: {
              name: st.name,
              lat: st.lat,
              lng: st.lng,
              external_source: CHMU_SOURCE,
              external_id: st.externalId,
              current_status: "unknown",
            },
            locale,
          });
          await strapi
            .documents(SPRING_UID)
            .publish({ documentId: created.documentId, locale });
          stats.created++;
          targets.push({
            documentId: created.documentId,
            externalId: st.externalId,
            lastReportAt: null,
          });
        } else {
          await strapi.documents(SPRING_UID).update({
            documentId: existing.documentId,
            data: { name: st.name, lat: st.lat, lng: st.lng },
            locale,
          });
          await strapi
            .documents(SPRING_UID)
            .publish({ documentId: existing.documentId, locale });
          stats.updated++;
          targets.push({
            documentId: existing.documentId,
            externalId: st.externalId,
            lastReportAt: existing.status_updated_at ?? null,
          });
        }
      } catch (err) {
        stats.errors++;
        strapi.log.error(
          `chmuSync: upsert failed for ${st.externalId}: ${(err as Error).message}`
        );
      }
    }

    // Phase B — download latest values, concurrency-limited. `now/` is
    // incomplete (many objects have no now file), so fall back to the recent/
    // monthly file (current month, then previous) which carries equally fresh
    // last points for those objects.
    const [curMonth, prevMonth] = recentMonths();
    const fetched = await mapWithConcurrency(targets, 8, async (t) => {
      try {
        let value = await fetchLatestValue(t.externalId); // now/
        let viaRecent = false;
        if (!value) {
          value = await fetchRecentValue(t.externalId, curMonth);
          if (!value) value = await fetchRecentValue(t.externalId, prevMonth);
          viaRecent = value != null;
        }
        if (viaRecent) stats.recent++;
        return { t, value };
      } catch (err) {
        stats.errors++;
        strapi.log.warn(
          `chmuSync: value fetch failed for ${t.externalId}: ${(err as Error).message}`
        );
        return { t, value: null };
      }
    });

    // Phase C — append a report only when ČHMÚ is strictly newer, then refresh.
    for (const { t, value } of fetched) {
      if (!value) {
        stats.skipped++;
        continue;
      }
      const isNewer =
        !t.lastReportAt || new Date(value.dt) > new Date(t.lastReportAt);
      if (!isNewer) {
        stats.skipped++;
        continue;
      }

      try {
        const flowScale = await strapi
          .service(CONFIG_UID)
          .flowScaleFromLps(value.valueLps);

        await strapi.documents(REPORT_UID).create({
          // ČHMÚ sensor reports legitimately omit has_odor / water_clarity /
          // device_id (now nullable) and client_report_id (idempotence here is
          // handled by the `dt`-newer check above, not the offline-queue id).
          data: {
            spring: t.documentId,
            is_flowing: value.valueLps > 0,
            flow_rate_lps: value.valueLps,
            flow_scale: flowScale,
            reported_at: value.dt,
          },
        });

        await strapi.service(SPRING_UID).refreshLatest(t.documentId);
        stats.reports++;
      } catch (err) {
        stats.errors++;
        strapi.log.error(
          `chmuSync: report failed for ${t.externalId}: ${(err as Error).message}`
        );
      }
    }

    strapi.log.info(`chmuSync done: ${JSON.stringify(stats)}`);
    return stats;
  },
}));
