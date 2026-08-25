import { beforeEach, describe, expect, it, vi } from "vitest";

const chmu = vi.hoisted(() => ({
  listSpringStations: vi.fn(),
  fetchLatestValue: vi.fn(),
  fetchRecentValue: vi.fn(),
}));

vi.mock("../../src/api/spring/services/chmu-client", () => ({
  ...chmu,
  recentMonths: () => ["202608", "202607"],
}));

vi.mock("@strapi/strapi", () => ({
  factories: {
    createCoreService:
      (_uid: string, cfg: (ctx: { strapi: unknown }) => unknown) =>
      ({ strapi }: { strapi: unknown }) =>
        cfg({ strapi }),
  },
}));

import springServiceFactory from "../../src/api/spring/services/spring";

const station = {
  externalId: "CHMU-1",
  name: "Žofínský pramen",
  lat: 49.1,
  lng: 16.6,
  altitude: 300,
};

function buildService(
  findExisting: (args: Record<string, unknown>) => unknown,
  options: { defaultLocale?: string; configured?: string[] } = {},
) {
  const create = vi.fn(async () => ({ documentId: "spring-1" }));
  const update = vi.fn(async () => ({ documentId: "spring-1" }));
  const publish = vi.fn(async () => ({ documentId: "spring-1" }));
  const reportCreate = vi.fn();
  const dbFindOne = vi.fn(async (args) => findExisting(args));
  const log = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const localesService = {
    getDefaultLocale: vi.fn(async () => options.defaultLocale ?? "cs"),
    find: vi.fn(async () =>
      (options.configured ?? ["cs", "en", "de"]).map((code) => ({ code })),
    ),
  };
  const strapi = {
    contentTypes: {
      "api::spring.spring": { attributes: { name_search: {} } },
    },
    documents: vi.fn((uid: string) =>
      uid === "api::spring.spring"
        ? { create, update, publish }
        : { create: reportCreate },
    ),
    db: {
      query: vi.fn(() => ({ findOne: dbFindOne })),
    },
    plugin: vi.fn(() => ({ service: vi.fn(() => localesService) })),
    service: vi.fn(() => ({
      flowScaleFromLps: vi.fn(),
      refreshLatest: vi.fn(),
    })),
    log,
  } as never;

  return {
    service: springServiceFactory({ strapi }) as unknown as {
      syncFromChmu: () => Promise<Record<string, any>>;
    },
    create,
    update,
    publish,
    reportCreate,
    dbFindOne,
    log,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  chmu.listSpringStations.mockResolvedValue([station]);
  chmu.fetchLatestValue.mockResolvedValue(null);
  chmu.fetchRecentValue.mockResolvedValue(null);
});

describe("spring.syncFromChmu localization", () => {
  it("creates and publishes a new station only in Czech even when default is English", async () => {
    const { service, create, update, publish } = buildService(() => null, {
      defaultLocale: "en",
    });

    const stats = await service.syncFromChmu();

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({
      locale: "cs",
      data: {
        name: "Žofínský pramen",
        name_search: "zofinsky pramen",
        source_locale: "cs",
      },
    });
    expect(update).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith({
      documentId: "spring-1",
      locale: "cs",
    });
    expect(stats).toMatchObject({
      locales: ["cs", "en", "de"],
      default_locale: "en",
      sync_locale: "cs",
      created: 1,
      localized_created: 1,
      localized_updated: 0,
      skipped: 1,
      errors: 0,
    });
  });

  it("does not publish when create returns no documentId", async () => {
    const { service, create, publish, log } = buildService(() => null);
    create.mockResolvedValueOnce({ documentId: undefined });

    const stats = await service.syncFromChmu();

    expect(publish).not.toHaveBeenCalled();
    expect(stats.errors).toBe(1);
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining("No documentId resolved for CHMU-1"),
    );
  });

  it("updates only the existing Czech variant and leaves translated content out of the write", async () => {
    const { service, create, update, publish } = buildService(
      (args: any) =>
        args.where.documentId
          ? { id: 10 }
          : {
              documentId: "spring-1",
              status_updated_at: null,
              source_locale: "cs",
            },
      { defaultLocale: "en" },
    );

    const stats = await service.syncFromChmu();

    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]).toMatchObject({
      documentId: "spring-1",
      locale: "cs",
      data: {
        name: "Žofínský pramen",
        name_search: "zofinsky pramen",
      },
    });
    expect(update.mock.calls[0][0].data).not.toHaveProperty("description");
    expect(publish).toHaveBeenCalledTimes(1);
    expect(stats).toMatchObject({
      updated: 1,
      localized_created: 0,
      localized_updated: 1,
      errors: 0,
    });
    expect(Object.keys(stats)).toEqual(
      expect.arrayContaining([
        "stations",
        "locales",
        "default_locale",
        "sync_locale",
        "created",
        "updated",
        "localized_created",
        "localized_updated",
        "reports",
        "recent",
        "skipped",
        "errors",
      ]),
    );
  });

  it("records an error and makes no write when the Czech variant is missing", async () => {
    const { service, create, update, publish, log } = buildService(
      (args: any) =>
        args.where.documentId
          ? null
          : {
              documentId: "spring-1",
              status_updated_at: null,
              source_locale: "cs",
            },
      { defaultLocale: "en" },
    );

    const stats = await service.syncFromChmu();

    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(stats).toMatchObject({ updated: 0, errors: 1, skipped: 0 });
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining("has no draft in ČHMÚ source locale cs"),
    );
  });

  it("rejects a ČHMÚ document whose immutable source locale is not Czech", async () => {
    const { service, update, publish, log } = buildService(() => ({
      documentId: "spring-1",
      status_updated_at: null,
      source_locale: "en",
    }));

    const stats = await service.syncFromChmu();

    expect(update).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(stats.errors).toBe(1);
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining("expected cs for ČHMÚ"),
    );
  });

  it("fails before fetching source data when Czech is not configured", async () => {
    const { service, create, update, publish } = buildService(() => null, {
      defaultLocale: "en",
      configured: ["en", "de"],
    });

    await expect(service.syncFromChmu()).rejects.toThrow(
      "requires configured source locale cs",
    );
    expect(chmu.listSpringStations).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
});
