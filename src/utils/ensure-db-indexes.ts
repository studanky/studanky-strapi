import type { Core } from "@strapi/strapi";

type Knex = Core.Strapi["db"]["connection"];

type IndexSpec = {
  table: string;
  columns: string[];
  name: string;
  unique?: boolean;
};

const INDEXES: IndexSpec[] = [
  {
    table: "springs",
    columns: ["external_source", "external_id"],
    name: "springs_external_source_external_id_idx",
  },
  {
    table: "springs",
    columns: ["lat", "lng"],
    name: "springs_lat_lng_idx",
  },
  {
    table: "springs",
    columns: ["status_updated_at"],
    name: "springs_status_updated_at_idx",
  },
  {
    table: "reports",
    columns: ["client_report_id"],
    name: "reports_client_report_id_uq",
    unique: true,
  },
  {
    table: "reports",
    columns: ["reported_at"],
    name: "reports_reported_at_idx",
  },
];

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

const indexExists = async (knex: Knex, table: string, name: string) => {
  const client = clientName(knex);

  if (client.includes("pg") || client.includes("postgres")) {
    const result = await knex.raw(
      "select 1 from pg_indexes where schemaname = current_schema() and tablename = ? and indexname = ? limit 1",
      [table, name]
    );
    return rowsFromRaw(result).length > 0;
  }

  if (client.includes("sqlite")) {
    const result = await knex.raw(
      "select name from sqlite_master where type = 'index' and tbl_name = ? and name = ? limit 1",
      [table, name]
    );
    return rowsFromRaw(result).length > 0;
  }

  if (client.includes("mysql") || client.includes("maria")) {
    const result = await knex.raw(
      "select 1 from information_schema.statistics where table_schema = database() and table_name = ? and index_name = ? limit 1",
      [table, name]
    );
    return rowsFromRaw(result).length > 0;
  }

  return false;
};

const hasColumns = async (knex: Knex, table: string, columns: string[]) => {
  for (const column of columns) {
    if (!(await knex.schema.hasColumn(table, column))) {
      return false;
    }
  }
  return true;
};

const isDuplicateIndexError = (error: unknown) => {
  const err = error as { code?: string; errno?: number; message?: string };
  const message = err.message?.toLowerCase() ?? "";

  return (
    err.code === "42P07" ||
    err.code === "42710" ||
    err.errno === 1061 ||
    message.includes("already exists") ||
    message.includes("duplicate") ||
    message.includes("already an index")
  );
};

const createIndex = async (knex: Knex, spec: IndexSpec) => {
  await knex.schema.alterTable(spec.table, (table) => {
    if (spec.unique) {
      table.unique(spec.columns, { indexName: spec.name });
      return;
    }
    table.index(spec.columns, spec.name);
  });
};

export const ensureDbIndexes = async (strapi: Core.Strapi) => {
  const knex = strapi.db.connection;

  for (const spec of INDEXES) {
    if (!(await knex.schema.hasTable(spec.table))) {
      strapi.log.warn(
        `[db-indexes] Table ${spec.table} does not exist yet; skipping ${spec.name}.`
      );
      continue;
    }

    if (!(await hasColumns(knex, spec.table, spec.columns))) {
      strapi.log.warn(
        `[db-indexes] Table ${spec.table} is missing columns for ${spec.name}; skipping.`
      );
      continue;
    }

    if (await indexExists(knex, spec.table, spec.name)) {
      continue;
    }

    try {
      await createIndex(knex, spec);
      strapi.log.info(`[db-indexes] Created ${spec.name}.`);
    } catch (error) {
      if (!isDuplicateIndexError(error)) {
        throw error;
      }
    }
  }
};
