import type { Core } from "@strapi/strapi";
import { normalizeSearchText } from "./search";

type Knex = Core.Strapi["db"]["connection"];

type SpringSearchRow = {
  id: number;
  name: string | null;
  name_search: string | null;
};

const SPRINGS_TABLE = "springs";
const NAME_SEARCH_COLUMN = "name_search";
const NAME_SEARCH_TRGM_INDEX = "springs_name_search_trgm_idx";

const rowsFromRaw = (result: unknown): unknown[] => {
  if (Array.isArray(result)) {
    return Array.isArray(result[0]) ? result[0] : result;
  }
  if (
    result &&
    typeof result === "object" &&
    "rows" in result &&
    Array.isArray((result as { rows: unknown[] }).rows)
  ) {
    return (result as { rows: unknown[] }).rows;
  }
  return [];
};

const clientName = (knex: Knex) =>
  String(
    knex.client?.config?.client ??
      (knex.client as { dialect?: string } | undefined)?.dialect ??
      ""
  ).toLowerCase();

const isPostgres = (knex: Knex) => {
  const client = clientName(knex);
  return client.includes("pg") || client.includes("postgres");
};

const hasNameSearchColumn = async (knex: Knex) =>
  (await knex.schema.hasTable(SPRINGS_TABLE)) &&
  (await knex.schema.hasColumn(SPRINGS_TABLE, NAME_SEARCH_COLUMN));

const indexExists = async (knex: Knex, name: string) => {
  const result = await knex.raw(
    "select 1 from pg_indexes where schemaname = current_schema() and tablename = ? and indexname = ? limit 1",
    [SPRINGS_TABLE, name]
  );
  return rowsFromRaw(result).length > 0;
};

const isDuplicateIndexError = (error: unknown) => {
  const err = error as { code?: string; errno?: number; message?: string };
  const message = err.message?.toLowerCase() ?? "";

  return (
    err.code === "42P07" ||
    err.code === "42710" ||
    err.errno === 1061 ||
    message.includes("already exists") ||
    message.includes("duplicate")
  );
};

export const ensureSpringSearchNames = async (strapi: Core.Strapi) => {
  const knex = strapi.db.connection;
  if (!(await hasNameSearchColumn(knex))) {
    return;
  }

  const rows = (await knex<SpringSearchRow>(SPRINGS_TABLE)
    .select(["id", "name", "name_search"])
    .whereNotNull("name")) as SpringSearchRow[];

  let updated = 0;
  for (const row of rows) {
    const normalized = normalizeSearchText(row.name);
    if (row.name_search === normalized) {
      continue;
    }

    await knex(SPRINGS_TABLE)
      .where({ id: row.id })
      .update({ [NAME_SEARCH_COLUMN]: normalized });
    updated++;
  }

  if (updated > 0) {
    strapi.log.info(`[spring-search] Backfilled ${updated} name_search rows.`);
  }
};

export const ensureSpringSearchIndexes = async (strapi: Core.Strapi) => {
  const knex = strapi.db.connection;
  if (!(await hasNameSearchColumn(knex)) || !isPostgres(knex)) {
    return;
  }

  if (await indexExists(knex, NAME_SEARCH_TRGM_INDEX)) {
    return;
  }

  try {
    await knex.raw("create extension if not exists pg_trgm");
    await knex.raw(
      "create index ?? on ?? using gin (?? gin_trgm_ops) where ?? is not null",
      [
        NAME_SEARCH_TRGM_INDEX,
        SPRINGS_TABLE,
        NAME_SEARCH_COLUMN,
        NAME_SEARCH_COLUMN,
      ]
    );
    strapi.log.info(`[spring-search] Created ${NAME_SEARCH_TRGM_INDEX}.`);
  } catch (error) {
    if (isDuplicateIndexError(error)) {
      return;
    }

    strapi.log.warn(
      `[spring-search] Could not create ${NAME_SEARCH_TRGM_INDEX}: ${
        (error as Error).message
      }`
    );
  }
};
