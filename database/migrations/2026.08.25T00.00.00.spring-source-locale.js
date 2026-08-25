"use strict";

/**
 * Persists the immutable source locale of every Spring document.
 *
 * Strapi runs migrations before schema sync, so this migration creates the new
 * column itself on an existing database. A fresh database has no `springs`
 * table yet and is therefore a safe no-op; schema sync creates the field later.
 * The same Knex code is used by SQLite and PostgreSQL.
 */

const REQUIRED_COLUMNS = [
  "id",
  "document_id",
  "locale",
  "created_at",
  "external_source",
];

function timestamp(value) {
  const parsed =
    value instanceof Date
      ? value.getTime()
      : typeof value === "number"
        ? value
        : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function inferSourceLocale(documentId, rows) {
  const existing = [
    ...new Set(
      rows
        .map((row) => row.source_locale)
        .filter((value) => typeof value === "string" && value.trim())
        .map((value) => value.trim())
    ),
  ];
  if (existing.length > 1) {
    throw new Error(
      `Spring source-locale migration found conflicting source locales for document ${documentId}: ${existing.join(
        ", "
      )}`
    );
  }

  const locales = [...new Set(rows.map((row) => row.locale).filter(Boolean))];
  if (existing.length === 1) {
    if (!locales.includes(existing[0])) {
      throw new Error(
        `Spring source-locale migration cannot find source variant ${existing[0]} for document ${documentId}`
      );
    }
    return existing[0];
  }

  if (rows.some((row) => row.external_source === "chmu")) {
    if (!locales.includes("cs")) {
      throw new Error(
        `ČHMÚ Spring ${documentId} has no Czech source-locale row`
      );
    }
    return "cs";
  }

  if (locales.length === 1) {
    return locales[0];
  }

  // For pre-existing manually authored documents, the first-created locale is
  // the only safe automatic approximation of the original language. Fail on a
  // tie or invalid timestamp instead of silently equating source with the
  // mutable global default locale.
  const earliestByLocale = new Map();
  for (const row of rows) {
    const value = timestamp(row.created_at);
    if (value == null) {
      throw new Error(
        `Spring source-locale migration cannot parse created_at for document ${documentId}, row ${row.id}`
      );
    }
    const previous = earliestByLocale.get(row.locale);
    if (previous == null || value < previous) {
      earliestByLocale.set(row.locale, value);
    }
  }

  const earliest = Math.min(...earliestByLocale.values());
  const candidates = [...earliestByLocale.entries()]
    .filter(([, value]) => value === earliest)
    .map(([locale]) => locale);
  if (candidates.length !== 1) {
    throw new Error(
      `Spring source-locale migration cannot infer an unambiguous source locale for document ${documentId}; candidates: ${candidates.join(
        ", "
      )}`
    );
  }
  return candidates[0];
}

module.exports = {
  async up(knex) {
    if (!(await knex.schema.hasTable("springs"))) {
      return;
    }

    const missing = [];
    for (const column of REQUIRED_COLUMNS) {
      if (!(await knex.schema.hasColumn("springs", column))) {
        missing.push(column);
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `Spring source-locale migration cannot run: springs is missing columns ${missing.join(
          ", "
        )}`
      );
    }

    if (!(await knex.schema.hasColumn("springs", "source_locale"))) {
      await knex.schema.alterTable("springs", (table) => {
        table.string("source_locale");
      });
    }

    const rows = await knex("springs").select([
      ...REQUIRED_COLUMNS,
      "source_locale",
    ]);
    const byDocument = new Map();
    for (const row of rows) {
      if (!row.document_id || !row.locale) {
        throw new Error(
          `Spring source-locale migration found invalid Spring row id=${row.id}`
        );
      }
      const group = byDocument.get(row.document_id) ?? [];
      group.push(row);
      byDocument.set(row.document_id, group);
    }

    for (const [documentId, documentRows] of byDocument) {
      const sourceLocale = inferSourceLocale(documentId, documentRows);
      await knex("springs")
        .where({ document_id: documentId })
        .update({ source_locale: sourceLocale });
    }
  },
};
