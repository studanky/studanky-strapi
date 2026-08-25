import { describe, it, expect, vi } from "vitest";

// Stub the Strapi factory so importing the service doesn't pull in the whole
// `@strapi/core` runtime (which fails to resolve under vitest's node ESM). The
// real `createCoreService(uid, cfg)` returns `({ strapi }) => service`, merging
// core CRUD onto the user methods; for testing `preview` we only need the user
// methods, so the fake just invokes `cfg({ strapi })`.
vi.mock("@strapi/strapi", () => ({
  factories: {
    createCoreService:
      (_uid: string, cfg: (ctx: { strapi: unknown }) => unknown) =>
      ({ strapi }: { strapi: unknown }) =>
        cfg({ strapi }),
  },
}));

import springServiceFactory from "../../src/api/spring/services/spring";

/**
 * Service-contract tests for `spring.preview` — the public web share endpoint.
 *
 * We instantiate the real service factory with a mock `strapi`, stubbing only
 * `strapi.documents().findOne` and the i18n locale services. This exercises the
 * actual locale-fallback loop (exact/parents → siblings → default → source) and the returned
 * `servedLocale`, complementing the pure `resolveLocaleChain` unit tests.
 */

const sampleRow = () => ({
  documentId: "doc1",
  name: "Ostružná",
  lat: 50.18,
  lng: 17.05,
  description: null,
  current_status: "is_flowing",
  status_updated_at: "2026-06-07T05:00:00.000Z",
  photo: null,
});

function buildService(opts: {
  findOne: (args: {
    locale: string;
    documentId: string;
    fields: string[];
  }) => Promise<unknown>;
  defaultLocale?: string;
  configured?: string[];
  sourceLocale?: string;
}) {
  const localesService = {
    getDefaultLocale: vi.fn(async () => opts.defaultLocale ?? "en"),
    find: vi.fn(async () =>
      (opts.configured ?? ["cs", "en"]).map((code) => ({ code })),
    ),
  };
  const findOne = vi.fn(opts.findOne);
  const strapi = {
    documents: () => ({ findOne }),
    db: {
      query: () => ({
        findOne: async ({ where }: { where: { documentId: string } }) => ({
          documentId: where.documentId,
          source_locale: opts.sourceLocale ?? "cs",
        }),
      }),
    },
    config: { get: () => ({ en: ["en-US", "en-GB"] }) },
    plugin: () => ({ service: () => localesService }),
    log: { debug() {}, info() {}, warn() {}, error() {} },
  } as never;

  const service = springServiceFactory({ strapi }) as unknown as {
    preview: (
      documentId: string,
      locale?: string,
    ) => Promise<Record<string, unknown> | null>;
  };
  return { service, findOne };
}

describe("spring.preview — service contract", () => {
  it("serves the requested locale in a single query when it hits", async () => {
    const { service, findOne } = buildService({
      defaultLocale: "en",
      configured: ["cs", "en"],
      findOne: async ({ locale }) => (locale === "cs" ? sampleRow() : null),
    });

    const res = await service.preview("doc1", "cs");

    expect(findOne).toHaveBeenCalledTimes(1);
    expect(findOne.mock.calls[0][0].locale).toBe("cs");
    expect(res).toMatchObject({ documentId: "doc1", locale: "cs" });
  });

  it("falls back to the default locale and reports it as the served locale", async () => {
    const { service, findOne } = buildService({
      defaultLocale: "en",
      configured: ["cs", "en"],
      // Not published in the requested locale, only in the default.
      findOne: async ({ locale }) => (locale === "en" ? sampleRow() : null),
    });

    const res = await service.preview("doc1", "cs");

    expect(findOne).toHaveBeenCalledTimes(2);
    expect(findOne.mock.calls[0][0].locale).toBe("cs"); // requested first
    expect(findOne.mock.calls[1][0].locale).toBe("en"); // then default
    expect(res?.locale).toBe("en");
  });

  it("falls back from a regional locale to its configured base language", async () => {
    const { service, findOne } = buildService({
      defaultLocale: "cs",
      configured: ["cs", "en", "en-US"],
      findOne: async ({ locale }) => (locale === "en" ? sampleRow() : null),
    });

    const res = await service.preview("doc1", "en-US");

    expect(findOne.mock.calls.map(([query]) => query.locale)).toEqual([
      "en-US",
      "en",
    ]);
    expect(res?.locale).toBe("en");
  });

  it("falls back from en-AU to a configured en-US sibling before Czech", async () => {
    const { service, findOne } = buildService({
      defaultLocale: "cs",
      configured: ["cs", "en-US"],
      findOne: async ({ locale }) => (locale === "en-US" ? sampleRow() : null),
    });

    const res = await service.preview("doc1", "en-AU");

    expect(findOne.mock.calls.map(([query]) => query.locale)).toEqual([
      "en-US",
    ]);
    expect(res?.locale).toBe("en-US");
  });

  it("uses the source locale after a missing different-language default", async () => {
    const { service, findOne } = buildService({
      defaultLocale: "en",
      configured: ["cs", "en"],
      sourceLocale: "cs",
      findOne: async ({ locale }) => (locale === "cs" ? sampleRow() : null),
    });

    const res = await service.preview("doc1", "de-DE");

    expect(findOne.mock.calls.map(([query]) => query.locale)).toEqual([
      "en",
      "cs",
    ]);
    expect(res?.locale).toBe("cs");
  });

  it("never queries an unsupported (unconfigured) locale — goes straight to default", async () => {
    const { service, findOne } = buildService({
      defaultLocale: "en",
      configured: ["cs", "en"],
      findOne: async ({ locale }) => (locale === "en" ? sampleRow() : null),
    });

    const res = await service.preview("doc1", "de"); // 'de' is not configured

    expect(findOne).toHaveBeenCalledTimes(1);
    expect(findOne.mock.calls[0][0].locale).toBe("en");
    expect(res?.locale).toBe("en");
  });

  it("returns null (→ 404) when the spring is absent in every attempted locale", async () => {
    const { service, findOne } = buildService({
      defaultLocale: "en",
      configured: ["cs", "en"],
      findOne: async () => null,
    });

    const res = await service.preview("nope", "cs");

    expect(res).toBeNull();
    expect(findOne).toHaveBeenCalled();
  });

  it("never selects flow-strength fields (teaser boundary held at the query)", async () => {
    const { service, findOne } = buildService({
      findOne: async () => sampleRow(),
    });

    await service.preview("doc1", "cs");

    const fields = findOne.mock.calls[0][0].fields as string[];
    expect(fields).not.toContain("last_flow_scale");
    expect(fields).not.toContain("last_flow_rate_lps");
  });

  it("returns null for an empty documentId without querying", async () => {
    const { service, findOne } = buildService({
      findOne: async () => sampleRow(),
    });

    const res = await service.preview("");

    expect(res).toBeNull();
    expect(findOne).not.toHaveBeenCalled();
  });
});
