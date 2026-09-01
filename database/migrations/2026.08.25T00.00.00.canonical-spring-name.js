"use strict";

/**
 * Makes the immutable source-locale Spring name canonical for every existing
 * localization of the same document and publication state.
 *
 * The source-locale migration runs immediately before this migration. Strapi
 * executes each `up(knex)` in a transaction and before content-type schema
 * synchronization. Consequently this migration deliberately performs no DDL:
 * a fresh database (without `springs`) is a safe no-op, while an existing
 * database is normalized before `name` / `name_search` become non-localized.
 *
 * The Knex API used below is shared by SQLite and PostgreSQL.
 */

const REQUIRED_SPRING_COLUMNS = [
  "id",
  "document_id",
  "locale",
  "published_at",
  "name",
  "name_search",
  "source_locale",
];

function normalizeSearchText(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = {
  async up(knex) {
    if (!(await knex.schema.hasTable("springs"))) {
      return;
    }

    const missingColumns = [];
    for (const column of REQUIRED_SPRING_COLUMNS) {
      if (!(await knex.schema.hasColumn("springs", column))) {
        missingColumns.push(column);
      }
    }

    if (missingColumns.length > 0) {
      throw new Error(
        `Canonical Spring name migration cannot run: springs is missing columns ${missingColumns.join(
          ", ",
        )}`,
      );
    }

    const rows = await knex("springs").select(REQUIRED_SPRING_COLUMNS);
    if (rows.length === 0) {
      return;
    }

    const groups = new Map();
    for (const row of rows) {
      if (!row.document_id || !row.locale) {
        throw new Error(
          `Canonical Spring name migration found invalid Spring row id=${row.id}`,
        );
      }

      const publicationState = row.published_at == null ? "draft" : "published";
      const key = `${row.document_id}\u0000${publicationState}`;
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }

    // Validate every group before making any update. Strapi also wraps the
    // migration in a transaction, so any unexpected database error rolls back.
    const updates = [];
    for (const [key, group] of groups) {
      const [documentId, publicationState] = key.split("\u0000");
      const sourceLocales = [
        ...new Set(
          group
            .map((row) => row.source_locale)
            .filter((value) => typeof value === "string" && value.trim())
            .map((value) => value.trim()),
        ),
      ];
      if (
        sourceLocales.length !== 1 ||
        group.some((row) => row.source_locale !== sourceLocales[0])
      ) {
        throw new Error(
          `Canonical Spring name migration requires one consistent source_locale on every ${publicationState} row for document ${documentId}`,
        );
      }

      const sourceLocale = sourceLocales[0];
      const baselines = group.filter((row) => row.locale === sourceLocale);
      if (baselines.length !== 1) {
        throw new Error(
          `Canonical Spring name migration requires exactly one ${sourceLocale} ${publicationState} row for document ${documentId}; found ${baselines.length}`,
        );
      }

      const canonicalName = baselines[0].name;
      if (typeof canonicalName !== "string" || !canonicalName.trim()) {
        throw new Error(
          `Canonical Spring name migration found an empty source-locale name for document ${documentId}`,
        );
      }

      const canonicalSearchName = normalizeSearchText(canonicalName);
      for (const row of group) {
        if (
          row.name !== canonicalName ||
          row.name_search !== canonicalSearchName
        ) {
          updates.push({
            id: row.id,
            name: canonicalName,
            nameSearch: canonicalSearchName,
          });
        }
      }
    }

    for (const update of updates) {
      await knex("springs").where({ id: update.id }).update({
        name: update.name,
        name_search: update.nameSearch,
      });
    }
  },
};
