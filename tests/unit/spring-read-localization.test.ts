import { describe, expect, it, vi } from "vitest";

vi.mock("@strapi/strapi", () => ({
  factories: {
    createCoreService:
      (_uid: string, cfg: (ctx: { strapi: unknown }) => unknown) =>
      ({ strapi }: { strapi: unknown }) =>
        cfg({ strapi }),
  },
}));

import springServiceFactory from "../../src/api/spring/services/spring";

type Service = {
  search: (
    params: Record<string, unknown>,
  ) => Promise<Array<Record<string, unknown>>>;
  findInBbox: (
    bbox: string,
    locale?: string,
  ) => Promise<Array<Record<string, unknown>>>;
  findOneWithLocaleFallback: (
    documentId: string,
    params?: Record<string, unknown>,
  ) => Promise<Record<string, unknown> | null>;
};

function buildService(options: {
  defaultLocale?: string;
  configured?: string[];
  findMany?: (args: Record<string, unknown>) => Promise<unknown[]>;
  findOne?: (args: Record<string, unknown>) => Promise<unknown>;
  sourceLocale?: string;
}) {
  const localesService = {
    getDefaultLocale: vi.fn(async () => options.defaultLocale ?? "cs"),
    find: vi.fn(async () =>
      (options.configured ?? ["cs", "en"]).map((code) => ({ code })),
    ),
  };
  const findMany = vi.fn(options.findMany ?? (async () => []));
  const findOne = vi.fn(options.findOne ?? (async () => null));
  const findSource = vi.fn(async ({ where }: Record<string, any>) => ({
    documentId: where.documentId,
    source_locale: options.sourceLocale ?? "cs",
  }));
  const log = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const strapi = {
    contentTypes: {
      "api::spring.spring": { attributes: { name_search: {} } },
    },
    documents: vi.fn(() => ({ findMany: vi.fn(async () => []), findOne })),
    db: {
      query: vi.fn(() => ({ findMany, findOne: findSource })),
    },
    config: {
      get: vi.fn(() => ({ en: ["en-US", "en-GB"] })),
    },
    plugin: vi.fn(() => ({ service: vi.fn(() => localesService) })),
    log,
  } as never;

  return {
    service: springServiceFactory({ strapi }) as unknown as Service,
    findMany,
    findOne,
    findSource,
    localesService,
    log,
  };
}

describe("spring.map — document locale fallback", () => {
  it("deduplicates locale rows and falls back to each document's source locale", async () => {
    const { service, findMany } = buildService({
      defaultLocale: "en-US",
      configured: ["cs", "en-US"],
      findMany: async () => [
        {
          documentId: "translated",
          name: "Translated",
          lat: 50,
          lng: 14,
          current_status: "unknown",
          status_updated_at: null,
          locale: "en-US",
          source_locale: "cs",
        },
        {
          documentId: "translated",
          name: "Translated",
          lat: 50,
          lng: 14,
          current_status: "unknown",
          status_updated_at: null,
          locale: "cs",
          source_locale: "cs",
        },
        {
          documentId: "czech-only",
          name: "Czech only",
          lat: 50.1,
          lng: 14.1,
          current_status: "unknown",
          status_updated_at: null,
          locale: "cs",
          source_locale: "cs",
        },
      ],
    });

    const result = await service.findInBbox("13,49,15,51", "en-AU");

    expect(result.map((row) => [row.documentId, row.locale])).toEqual([
      ["translated", "en-US"],
      ["czech-only", "cs"],
    ]);
    expect(result.every((row) => !("source_locale" in row))).toBe(true);
    expect(findMany.mock.calls[0][0]).toMatchObject({
      where: {
        publishedAt: { $notNull: true },
        locale: { $in: ["cs", "en-US"] },
      },
    });
  });

  it("logs and skips a corrupt document without hiding healthy map rows", async () => {
    const { service, log } = buildService({
      findMany: async () => [
        {
          documentId: "healthy",
          name: "Healthy",
          lat: 50,
          lng: 14,
          current_status: "unknown",
          status_updated_at: null,
          locale: "cs",
          source_locale: "cs",
        },
        {
          documentId: "corrupt",
          name: "Corrupt",
          lat: 50.1,
          lng: 14.1,
          current_status: "unknown",
          status_updated_at: null,
          locale: "cs",
          source_locale: null,
        },
      ],
    });

    await expect(service.findInBbox("13,49,15,51", "en")).resolves.toEqual([
      expect.objectContaining({ documentId: "healthy" }),
    ]);
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining("skipping invalid document corrupt"),
    );
  });

  it("keeps an empty global i18n configuration as a visible error", async () => {
    const { service, findMany } = buildService({ configured: [] });

    await expect(service.findInBbox("13,49,15,51", "en")).rejects.toThrow(
      "has no configured locales",
    );
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("spring.search — document locale fallback", () => {
  it("selects one whole published variant per document using the request and source locale", async () => {
    const { service, findMany } = buildService({
      defaultLocale: "cs",
      configured: ["cs", "en-US"],
      findMany: async () => [
        {
          documentId: "spring-1",
          name: "Žofie",
          lat: 49.1,
          lng: 16.6,
          current_status: "unknown",
          status_updated_at: null,
          locale: "en-US",
          source_locale: "cs",
        },
        {
          documentId: "spring-1",
          name: "Žofie",
          lat: 49.1,
          lng: 16.6,
          current_status: "unknown",
          status_updated_at: null,
          locale: "cs",
          source_locale: "cs",
        },
        {
          documentId: "spring-2",
          name: "Studánka",
          lat: 49.2,
          lng: 16.7,
          current_status: "unknown",
          status_updated_at: null,
          locale: "cs",
          source_locale: "cs",
        },
      ],
    });

    const result = await service.search({ q: "zofie", locale: "en-AU" });

    expect(result).toHaveLength(2);
    expect(result.map((row) => [row.documentId, row.locale])).toEqual([
      ["spring-1", "en-US"],
      ["spring-2", "cs"],
    ]);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0]).toMatchObject({
      where: {
        name_search: { $containsi: "zofie" },
        publishedAt: { $notNull: true },
        locale: { $in: ["cs", "en-US"] },
      },
    });
  });

  it("preserves limit, distance and nearest-first ordering", async () => {
    const { service } = buildService({
      findMany: async () => [
        {
          documentId: "far",
          name: "Far",
          lat: 50.1,
          lng: 14.1,
          current_status: "unknown",
          status_updated_at: null,
          locale: "cs",
          source_locale: "cs",
        },
        {
          documentId: "near",
          name: "Near",
          lat: 50.0001,
          lng: 14.0001,
          current_status: "unknown",
          status_updated_at: null,
          locale: "cs",
          source_locale: "cs",
        },
      ],
    });

    const result = await service.search({
      q: "spring",
      lat: 50,
      lng: 14,
      limit: 1,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ documentId: "near" });
    expect(result[0].distance_m).toEqual(expect.any(Number));
  });

  it("logs and skips a search candidate whose source locale is no longer configured", async () => {
    const { service, log } = buildService({
      configured: ["cs", "en"],
      findMany: async () => [
        {
          documentId: "healthy",
          name: "Healthy",
          lat: 50,
          lng: 14,
          current_status: "unknown",
          status_updated_at: null,
          locale: "cs",
          source_locale: "cs",
        },
        {
          documentId: "removed-source",
          name: "Removed source",
          lat: 50.1,
          lng: 14.1,
          current_status: "unknown",
          status_updated_at: null,
          locale: "cs",
          source_locale: "de",
        },
      ],
    });

    const result = await service.search({ q: "spring", locale: "en" });

    expect(result.map((row) => row.documentId)).toEqual(["healthy"]);
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining("skipping invalid document removed-source"),
    );
  });
});

describe("spring.findOneWithLocaleFallback", () => {
  it("returns an existing requested locale even when description is null", async () => {
    const english = { documentId: "spring-1", locale: "en", description: null };
    const { service, findOne } = buildService({
      findOne: async ({ locale }) => (locale === "en" ? english : null),
    });

    await expect(
      service.findOneWithLocaleFallback("spring-1", { locale: "en" }),
    ).resolves.toEqual(english);
    expect(findOne).toHaveBeenCalledTimes(1);
  });

  it("tries exact locale, base language, then the dynamic default/source", async () => {
    const czech = { documentId: "spring-1", locale: "cs" };
    const { service, findOne } = buildService({
      configured: ["cs", "en", "en-US"],
      findOne: async ({ locale }) => (locale === "cs" ? czech : null),
    });

    const result = await service.findOneWithLocaleFallback("spring-1", {
      locale: "en_US",
      fields: ["name", "description"],
      populate: { photo: true },
      status: "draft",
    });

    expect(result).toEqual(czech);
    expect(findOne.mock.calls.map(([query]) => query.locale)).toEqual([
      "en-US",
      "en",
      "cs",
    ]);
    for (const [query] of findOne.mock.calls) {
      expect(query).toMatchObject({
        documentId: "spring-1",
        fields: ["name", "description"],
        populate: { photo: true },
        status: "draft",
      });
    }
  });

  it("never sends an unsupported requested locale to Document Service", async () => {
    const { service, findOne } = buildService({
      defaultLocale: "cs",
      configured: ["cs", "en"],
      findOne: async () => ({ documentId: "spring-1", locale: "cs" }),
    });

    await service.findOneWithLocaleFallback("spring-1", { locale: "fr-FR" });

    expect(findOne).toHaveBeenCalledTimes(1);
    expect(findOne.mock.calls[0][0].locale).toBe("cs");
  });
});
