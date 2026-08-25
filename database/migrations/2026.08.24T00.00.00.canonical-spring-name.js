"use strict";

/**
 * Makes the current default-locale Spring name canonical for every existing
 * localization of the same document and publication state.
 *
 * Strapi executes `up(knex)` in a transaction and before content-type schema
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
];
const REQUIRED_CORE_STORE_COLUMNS = ["key", "value", "environment", "tag"];

function normalizeSearchText(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function parseDefaultLocale(storedValue) {
  if (typeof storedValue !== "string" || !storedValue.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(storedValue);
    return typeof parsed === "string" && parsed.trim() ? parsed.trim() : null;
  } catch {
    // Tolerate a plain string for forward/backward-compatible core-store data.
    return storedValue.trim();
  }
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

    if (!(await knex.schema.hasTable("strapi_core_store_settings"))) {
      throw new Error(
        "Canonical Spring name migration cannot determine the default locale: strapi_core_store_settings is missing",
      );
    }

    const missingCoreStoreColumns = [];
    for (const column of REQUIRED_CORE_STORE_COLUMNS) {
      if (
        !(await knex.schema.hasColumn("strapi_core_store_settings", column))
      ) {
        missingCoreStoreColumns.push(column);
      }
    }
    if (missingCoreStoreColumns.length > 0) {
      throw new Error(
        `Canonical Spring name migration cannot determine the default locale: strapi_core_store_settings is missing columns ${missingCoreStoreColumns.join(
          ", ",
        )}`,
      );
    }

    const setting = await knex("strapi_core_store_settings")
      .select("value")
      .where({ key: "plugin_i18n_default_locale" })
      .whereNull("environment")
      .whereNull("tag")
      .first();
    const defaultLocale = parseDefaultLocale(setting?.value);

    if (!defaultLocale) {
      throw new Error(
        "Canonical Spring name migration cannot determine the Strapi i18n default locale",
      );
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
      const baselines = group.filter((row) => row.locale === defaultLocale);
      if (baselines.length !== 1) {
        const [documentId, publicationState] = key.split("\u0000");
        throw new Error(
          `Canonical Spring name migration requires exactly one ${defaultLocale} ${publicationState} row for document ${documentId}; found ${baselines.length}`,
        );
      }

      const canonicalName = baselines[0].name;
      if (typeof canonicalName !== "string" || !canonicalName.trim()) {
        throw new Error(
          `Canonical Spring name migration found an empty default-locale name for document ${baselines[0].document_id}`,
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
