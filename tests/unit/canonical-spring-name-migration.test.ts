import { afterEach, describe, expect, it } from "vitest";
import knexFactory, { type Knex } from "knex";

// The migration is intentionally JavaScript because Strapi loads database
// migrations directly before compiling the TypeScript application.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const migration = require("../../database/migrations/2026.08.25T00.00.00.canonical-spring-name.js");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sourceLocaleMigration = require("../../database/migrations/2026.08.24T00.00.00.spring-source-locale.js");

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

async function createSprings(db: Knex) {
  await db.schema.createTable("springs", (table) => {
    table.increments("id").primary();
    table.string("document_id").notNullable();
    table.string("locale").notNullable();
    table.timestamp("published_at").nullable();
    table.timestamp("updated_at").nullable();
    table.string("name").notNullable();
    table.string("name_search").nullable();
    table.string("source_locale").nullable();
  });
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.destroy()));
});

describe("canonical Spring name migration", () => {
  it("runs after source-locale backfill on a pre-1.5.0 ČHMÚ schema", async () => {
    const db = createDatabase();
    await db.schema.createTable("springs", (table) => {
      table.increments("id").primary();
      table.string("document_id").notNullable();
      table.string("locale").notNullable();
      table.timestamp("created_at").notNullable();
      table.timestamp("published_at").nullable();
      table.string("external_source").nullable();
      table.string("name").notNullable();
      table.string("name_search").nullable();
    });
    await db("springs").insert([
      {
        document_id: "chmu-1",
        locale: "cs",
        created_at: "2026-01-01T00:00:00.000Z",
        published_at: null,
        external_source: "chmu",
        name: "Oficiální název",
        name_search: "stale",
      },
      {
        document_id: "chmu-1",
        locale: "en",
        created_at: "2026-02-01T00:00:00.000Z",
        published_at: null,
        external_source: "chmu",
        name: "Old translation",
        name_search: "old translation",
      },
    ]);

    await db.transaction((trx) => sourceLocaleMigration.up(trx));
    await db.transaction((trx) => migration.up(trx));

    const rows = await db("springs").orderBy("id");
    expect(rows.map((row) => row.source_locale)).toEqual(["cs", "cs"]);
    expect(rows.map((row) => row.name)).toEqual([
      "Oficiální název",
      "Oficiální název",
    ]);
    expect(rows.map((row) => row.name_search)).toEqual([
      "oficialni nazev",
      "oficialni nazev",
    ]);
  });

  it("uses the source-locale row separately for draft and published state", async () => {
    const db = createDatabase();
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
        source_locale: "cs",
      },
      {
        document_id: "doc-1",
        locale: "en",
        published_at: null,
        updated_at: unchangedTimestamp,
        name: "Translated draft",
        name_search: "translated draft",
        source_locale: "cs",
      },
      {
        document_id: "doc-1",
        locale: "cs",
        published_at: "2026-08-02T12:00:00.000Z",
        updated_at: unchangedTimestamp,
        name: "Žofínský pramen",
        name_search: null,
        source_locale: "cs",
      },
      {
        document_id: "doc-1",
        locale: "en",
        published_at: "2026-08-03T12:00:00.000Z",
        updated_at: unchangedTimestamp,
        name: "Translated published",
        name_search: "translated published",
        source_locale: "cs",
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

  it("fails and rolls back when a state has no source-locale row", async () => {
    const db = createDatabase();
    await createSprings(db);
    await db("springs").insert({
      document_id: "doc-1",
      locale: "en",
      published_at: null,
      name: "English only",
      name_search: "english only",
      source_locale: "cs",
    });

    await expect(db.transaction((trx) => migration.up(trx))).rejects.toThrow(
      "requires exactly one cs draft row",
    );
    await expect(db("springs").first()).resolves.toMatchObject({
      name: "English only",
      name_search: "english only",
    });
  });

  it("uses source_locale independently of the mutable Strapi default", async () => {
    const db = createDatabase();
    await createSprings(db);
    await db("springs").insert([
      {
        document_id: "doc-1",
        locale: "cs",
        published_at: null,
        name: "Český název",
        name_search: "cesky nazev",
        source_locale: "en",
      },
      {
        document_id: "doc-1",
        locale: "en",
        published_at: null,
        name: "Official source name",
        name_search: "official source name",
        source_locale: "en",
      },
    ]);

    await db.transaction((trx) => migration.up(trx));

    const rows = await db("springs").orderBy("id");
    expect(rows.map((row) => row.name)).toEqual([
      "Official source name",
      "Official source name",
    ]);
  });

  it("fails when source_locale is inconsistent across physical rows", async () => {
    const db = createDatabase();
    await createSprings(db);
    await db("springs").insert([
      {
        document_id: "doc-1",
        locale: "cs",
        published_at: null,
        name: "Český název",
        source_locale: "cs",
      },
      {
        document_id: "doc-1",
        locale: "en",
        published_at: null,
        name: "English name",
        source_locale: "en",
      },
    ]);

    await expect(db.transaction((trx) => migration.up(trx))).rejects.toThrow(
      "requires one consistent source_locale",
    );
  });

  it("is a safe no-op before schema sync on a fresh database", async () => {
    const db = createDatabase();
    await expect(migration.up(db)).resolves.toBeUndefined();
  });
});
