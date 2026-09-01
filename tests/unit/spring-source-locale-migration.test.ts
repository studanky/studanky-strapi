import { afterEach, describe, expect, it } from "vitest";
import knexFactory, { type Knex } from "knex";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const migration = require("../../database/migrations/2026.08.24T00.00.00.spring-source-locale.js");

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
    table.timestamp("created_at").notNullable();
    table.timestamp("published_at").nullable();
    table.string("external_source").nullable();
  });
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.destroy()));
});

describe("Spring source-locale migration", () => {
  it("sets ČHMÚ to Czech and infers a unique first-created locale for other documents", async () => {
    const db = createDatabase();
    await createSprings(db);
    await db("springs").insert([
      {
        document_id: "chmu",
        locale: "cs",
        created_at: "2026-01-01T00:00:00.000Z",
        external_source: "chmu",
      },
      {
        document_id: "chmu",
        locale: "en",
        created_at: "2026-02-01T00:00:00.000Z",
        external_source: "chmu",
      },
      {
        document_id: "manual",
        locale: "en",
        created_at: "2026-01-05T00:00:00.000Z",
      },
      {
        document_id: "manual",
        locale: "de",
        created_at: "2026-03-05T00:00:00.000Z",
      },
      {
        document_id: "single",
        locale: "de",
        created_at: "2026-04-05T00:00:00.000Z",
      },
    ]);

    await db.transaction((trx) => migration.up(trx));

    const rows = await db("springs").orderBy("id");
    expect(rows).toHaveLength(5);
    expect(rows.map((row) => [row.document_id, row.source_locale])).toEqual([
      ["chmu", "cs"],
      ["chmu", "cs"],
      ["manual", "en"],
      ["manual", "en"],
      ["single", "de"],
    ]);
  });

  it("fails instead of guessing when several locales have the same oldest timestamp", async () => {
    const db = createDatabase();
    await createSprings(db);
    await db("springs").insert([
      {
        document_id: "ambiguous",
        locale: "en",
        created_at: "2026-01-01T00:00:00.000Z",
      },
      {
        document_id: "ambiguous",
        locale: "de",
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ]);

    await expect(db.transaction((trx) => migration.up(trx))).rejects.toThrow(
      "cannot infer an unambiguous source locale",
    );
  });

  it("is a safe no-op before schema sync on a fresh database", async () => {
    const db = createDatabase();
    await expect(migration.up(db)).resolves.toBeUndefined();
  });
});
