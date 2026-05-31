"use strict";

/**
 * Adds the indexes the data model relies on but that the Content-Type Builder
 * cannot express:
 *
 *   springs:  INDEX  (external_source, external_id)  — ČHMÚ pairing lookup
 *             INDEX  (lat, lng)                       — map bbox query
 *             INDEX  (status_updated_at)              — freshness / sorting
 *   reports:  UNIQUE (client_report_id)               — offline-queue idempotence
 *             INDEX  (reported_at)                     — history sorting
 *
 * Written with the knex schema builder so it is portable across the supported
 * dialects (sqlite / mysql / postgres).
 *
 * NOTE — springs (external_source, external_id) is a PLAIN (non-unique) index,
 * not UNIQUE: Spring has Draft & Publish, so each published document is stored
 * as two rows (draft + published) sharing the same external_id. A naive DB
 * UNIQUE across all rows would reject the published row. Pairing uniqueness is
 * enforced in the ČHMÚ sync upsert logic instead (findFirst before create).
 * reports (client_report_id) is safe as UNIQUE because Report has D&P disabled
 * (one row per document); multiple NULLs are allowed by the index.
 *
 * Strapi runs this once and records it in `strapi_migrations`.
 */

const SPRINGS_EXT_IDX = "springs_external_source_external_id_idx";
const SPRINGS_LATLNG_IDX = "springs_lat_lng_idx";
const SPRINGS_STATUS_IDX = "springs_status_updated_at_idx";
const REPORTS_CRID_UQ = "reports_client_report_id_uq";
const REPORTS_REPORTED_IDX = "reports_reported_at_idx";

module.exports = {
  async up(knex) {
    await knex.schema.alterTable("springs", (t) => {
      t.index(["external_source", "external_id"], SPRINGS_EXT_IDX);
      t.index(["lat", "lng"], SPRINGS_LATLNG_IDX);
      t.index(["status_updated_at"], SPRINGS_STATUS_IDX);
    });

    await knex.schema.alterTable("reports", (t) => {
      t.unique(["client_report_id"], { indexName: REPORTS_CRID_UQ });
      t.index(["reported_at"], REPORTS_REPORTED_IDX);
    });
  },

  async down(knex) {
    await knex.schema.alterTable("springs", (t) => {
      t.dropIndex(["external_source", "external_id"], SPRINGS_EXT_IDX);
      t.dropIndex(["lat", "lng"], SPRINGS_LATLNG_IDX);
      t.dropIndex(["status_updated_at"], SPRINGS_STATUS_IDX);
    });

    await knex.schema.alterTable("reports", (t) => {
      t.dropUnique(["client_report_id"], REPORTS_CRID_UQ);
      t.dropIndex(["reported_at"], REPORTS_REPORTED_IDX);
    });
  },
};
