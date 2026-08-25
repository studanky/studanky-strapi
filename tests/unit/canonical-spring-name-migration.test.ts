import { afterEach, describe, expect, it } from "vitest";
import knexFactory, { type Knex } from "knex";

// The migration is intentionally JavaScript because Strapi loads database
// migrations directly before compiling the TypeScript application.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const migration = require("../../database/migrations/2026.08.24T00.00.00.canonical-spring-name.js");

const databases: Knex[] = [];

function createDatabase() {
  const db = knexFactory({
    client: "better-sqlite3",
    connection: { filename: ":memory:" },
    useNullAsDefault: true,
  });
  databases.push(db);
  return db;
}

async function createCoreStore(db: Knex, defaultLocale = "cs") {
  await db.schema.createTable("strapi_core_store_settings", (table) => {
    table.increments("id").primary();
    table.string("key");
    table.text("value");
    table.string("environment").nullable();
    table.string("tag").nullable();
  });
  await db("strapi_core_store_settings").insert({
    key: "plugin_i18n_default_locale",
    value: JSON.stringify(defaultLocale),
    environment: null,
    tag: null,
  });
}

async function createSprings(db: Knex) {
  await db.schema.createTable("springs", (table) => {
    table.increments("id").primary();
    table.string("document_id").notNullable();
    table.string("locale").notNullable();
    table.timestamp("published_at").nullable();
    table.timestamp("updated_at").nullable();
    table.string("name").notNullable();
    table.string("name_search").nullable();
  });
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.destroy()));
});

describe("canonical Spring name migration", () => {
  it("uses the default row separately for draft and published state", async () => {
    const db = createDatabase();
    await createCoreStore(db, "cs");
    await createSprings(db);
    const unchangedTimestamp = "2026-08-01T12:00:00.000Z";
    await db("springs").insert([
      {
        document_id: "doc-1",
        locale: "cs",
        published_at: null,
        updated_at: unchangedTimestamp,
        name: "Žofínský pramen – návrh",
        name_search: "stale",
      },
      {
        document_id: "doc-1",
        locale: "en",
        published_at: null,
        updated_at: unchangedTimestamp,
        name: "Translated draft",
        name_search: "translated draft",
      },
      {
        document_id: "doc-1",
        locale: "cs",
        published_at: "2026-08-02T12:00:00.000Z",
        updated_at: unchangedTimestamp,
        name: "Žofínský pramen",
        name_search: null,
      },
      {
        document_id: "doc-1",
        locale: "en",
        published_at: "2026-08-03T12:00:00.000Z",
        updated_at: unchangedTimestamp,
        name: "Translated published",
        name_search: "translated published",
      },
    ]);

    const beforeCount = Number(
      (await db("springs").count({ count: "*" }).first())?.count,
    );
    await db.transaction((trx) => migration.up(trx));
    const rows = await db("springs").orderBy("id");

    expect(rows).toHaveLength(beforeCount);
    expect(rows.map((row) => [row.document_id, row.locale])).toEqual([
      ["doc-1", "cs"],
      ["doc-1", "en"],
      ["doc-1", "cs"],
      ["doc-1", "en"],
    ]);
    expect(rows.slice(0, 2).map((row) => row.name)).toEqual([
      "Žofínský pramen – návrh",
      "Žofínský pramen – návrh",
    ]);
    expect(rows.slice(0, 2).map((row) => row.name_search)).toEqual([
      "zofinsky pramen – navrh",
      "zofinsky pramen – navrh",
    ]);
    expect(rows.slice(2).map((row) => row.name)).toEqual([
      "Žofínský pramen",
      "Žofínský pramen",
    ]);
    expect(rows.slice(2).map((row) => row.name_search)).toEqual([
      "zofinsky pramen",
      "zofinsky pramen",
    ]);
    expect(rows.every((row) => row.updated_at === unchangedTimestamp)).toBe(
      true,
    );
  });

  it("fails and rolls back when a state has no default-locale row", async () => {
    const db = createDatabase();
    await createCoreStore(db, "cs");
    await createSprings(db);
    await db("springs").insert({
      document_id: "doc-1",
      locale: "en",
      published_at: null,
      name: "English only",
      name_search: "english only",
    });

    await expect(db.transaction((trx) => migration.up(trx))).rejects.toThrow(
      "requires exactly one cs draft row",
    );
    await expect(db("springs").first()).resolves.toMatchObject({
      name: "English only",
      name_search: "english only",
    });
  });

  it("ignores environment-scoped core-store values", async () => {
    const db = createDatabase();
    await createCoreStore(db, "cs");
    await db("strapi_core_store_settings").insert({
      key: "plugin_i18n_default_locale",
      value: JSON.stringify("en"),
      environment: "production",
      tag: null,
    });
    await createSprings(db);
    await db("springs").insert([
      {
        document_id: "doc-1",
        locale: "cs",
        published_at: null,
        name: "Český název",
        name_search: "stale",
      },
      {
        document_id: "doc-1",
        locale: "en",
        published_at: null,
        name: "English name",
        name_search: "english name",
      },
    ]);

    await db.transaction((trx) => migration.up(trx));

    const rows = await db("springs").orderBy("id");
    expect(rows.map((row) => row.name)).toEqual(["Český název", "Český název"]);
  });

  it("is a safe no-op before schema sync on a fresh database", async () => {
    const db = createDatabase();
    await expect(migration.up(db)).resolves.toBeUndefined();
  });
});
