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
  const preview = vi.fn(async () => ({ documentId: "spring-1", locale: "cs" }));
  const strapi = {
    service: vi.fn(() => ({
      search,
      findInBbox,
      findOneWithLocaleFallback,
      preview,
    })),
  };
  const controller = springControllerFactory({ strapi }) as any;
  controller.validateQuery = vi.fn(async () => undefined);
  controller.sanitizeQuery = vi.fn(async (ctx) => ctx.query);
  controller.sanitizeOutput = vi.fn(async (entity) => entity);
  controller.transformResponse = vi.fn((data, meta) =>
    meta === undefined ? { data } : { data, meta },
  );
  return {
    controller,
    search,
    findInBbox,
    findOneWithLocaleFallback,
    preview,
  };
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

  it.each([
    ["map", { query: { bbox: "13,49,15,51" } }],
    ["search", { query: { q: "studanka" } }],
    ["findOne", { params: { id: "spring-1" }, query: {} }],
    ["preview", { params: { documentId: "spring-1" }, query: {} }],
  ])("rejects a missing locale on %s", async (action, partialCtx) => {
    const { controller } = buildController();
    const badRequest = vi.fn((message) => ({ status: 400, message }));
    const ctx = { ...partialCtx, badRequest };

    const response = await controller[action](ctx);

    expect(response).toEqual({
      status: 400,
      message:
        'Missing or invalid "locale" query (expected a BCP 47 tag, e.g. "en" or "en-US")',
    });
  });

  it("rejects a locale with a legacy underscore separator", async () => {
    const { controller, findInBbox } = buildController();
    const badRequest = vi.fn((message) => ({ status: 400, message }));
    const ctx = {
      query: { bbox: "13,49,15,51", locale: "en_US" },
      badRequest,
    };

    await expect(controller.map(ctx)).resolves.toMatchObject({ status: 400 });
    expect(findInBbox).not.toHaveBeenCalled();
  });

  it("canonicalizes locale casing at the HTTP boundary", async () => {
    const { controller, findInBbox } = buildController();
    const ctx = {
      query: { bbox: "13,49,15,51", locale: "EN-us" },
      badRequest: vi.fn(),
    };

    await controller.map(ctx);

    expect(findInBbox).toHaveBeenCalledWith("13,49,15,51", "en-US");
  });
});
