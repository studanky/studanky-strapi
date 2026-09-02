import { describe, expect, it, vi } from "vitest";

vi.mock("@strapi/strapi", () => ({
  factories: {
    createCoreController:
      (_uid: string, cfg: (ctx: { strapi: unknown }) => unknown) =>
      ({ strapi }: { strapi: unknown }) =>
        cfg({ strapi }),
  },
}));

import springControllerFactory from "../../src/api/spring/controllers/spring";

function buildController() {
  const search = vi.fn(async () => []);
  const findInBbox = vi.fn(async () => []);
  const findOneWithLocaleFallback = vi.fn(async () => ({
    documentId: "spring-1",
    locale: "cs",
  }));
  const strapi = {
    service: vi.fn(() => ({ search, findInBbox, findOneWithLocaleFallback })),
  };
  const controller = springControllerFactory({ strapi }) as any;
  controller.validateQuery = vi.fn(async () => undefined);
  controller.sanitizeQuery = vi.fn(async (ctx) => ctx.query);
  controller.sanitizeOutput = vi.fn(async (entity) => entity);
  controller.transformResponse = vi.fn((data, meta) =>
    meta === undefined ? { data } : { data, meta },
  );
  return { controller, search, findInBbox, findOneWithLocaleFallback };
}

describe("spring controller localization contracts", () => {
  it("forwards the Flutter language tag to search", async () => {
    const { controller, search } = buildController();
    const ctx = {
      query: { q: "studanka", locale: "en", limit: "5" },
      badRequest: vi.fn(),
    };

    await expect(controller.search(ctx)).resolves.toEqual({ data: [] });
    expect(search).toHaveBeenCalledWith({
      q: "studanka",
      lat: undefined,
      lng: undefined,
      limit: 5,
      locale: "en",
    });
  });

  it("forwards the Flutter language tag to map", async () => {
    const { controller, findInBbox } = buildController();
    const ctx = {
      query: { bbox: "13,49,15,51", locale: "en-AU" },
      badRequest: vi.fn(),
    };

    await expect(controller.map(ctx)).resolves.toEqual({ data: [] });
    expect(findInBbox).toHaveBeenCalledWith("13,49,15,51", "en-AU");
  });

  it("keeps core validation, sanitization and response envelope for detail", async () => {
    const { controller, findOneWithLocaleFallback } = buildController();
    const ctx = {
      params: { id: "spring-1" },
      query: {
        locale: "en-US",
        fields: ["name", "description"],
        populate: { photo: true },
        status: "published",
      },
    };

    const response = await controller.findOne(ctx);

    expect(controller.validateQuery).toHaveBeenCalledWith(ctx);
    expect(controller.sanitizeQuery).toHaveBeenCalledWith(ctx);
    expect(findOneWithLocaleFallback).toHaveBeenCalledWith(
      "spring-1",
      ctx.query,
    );
    expect(controller.sanitizeOutput).toHaveBeenCalledWith(
      { documentId: "spring-1", locale: "cs" },
      ctx,
    );
    expect(response).toEqual({
      data: { documentId: "spring-1", locale: "cs" },
    });
  });
});
