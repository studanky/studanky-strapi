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
 * Compatibility note:
 * Strapi runs database migrations before it creates content-type tables on a
 * fresh database. Creating these indexes here breaks first boot because
 * `springs` / `reports` do not exist yet. The indexes are now created
 * idempotently from `src/index.ts` bootstrap, after Strapi's schema sync.
 * This migration stays as a safe no-op so older databases that already saw this
 * filename keep a stable migration history.
 */

module.exports = {
  async up() {},

  async down() {},
};
