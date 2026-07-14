import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@strapi/strapi", () => ({
  factories: {
    createCoreController:
      (_uid: string, cfg: (ctx: { strapi: unknown }) => unknown) =>
      ({ strapi }: { strapi: unknown }) =>
        cfg({ strapi }),
  },
}));

const ENV_KEYS = [
  "NEWSLETTER_SUBSCRIBE_MAX_BODY_BYTES",
  "NEWSLETTER_EMAIL_RATE_LIMIT_HOUR_MAX",
  "NEWSLETTER_EMAIL_RATE_LIMIT_DAY_MAX",
  "NEWSLETTER_RATE_LIMIT_MAX_KEYS",
  "NEWSLETTER_RATE_LIMIT_SALT",
];

const originalEnv = new Map(
  ENV_KEYS.map((key) => [key, process.env[key]])
);

afterEach(() => {
  vi.resetModules();
  for (const key of ENV_KEYS) {
    const original = originalEnv.get(key);
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }
});

const loadController = async (env: Record<string, string> = {}) => {
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }

  const subscribe = vi.fn(async () => ({ created: true }));
  const strapi = {
    service: vi.fn(() => ({ subscribe })),
  };

  const mod = await import(
    "../../src/api/newsletter-subscriber/controllers/newsletter-subscriber"
  );
  const controller = mod.default({ strapi }) as unknown as {
    subscribe: (ctx: ReturnType<typeof makeCtx>) => Promise<unknown>;
  };

  return { controller, subscribe };
};

const makeCtx = (body: unknown, contentLength = "") => {
  const headers = new Map<string, string>();

  return {
    request: { body },
    status: 200,
    get: vi.fn((name: string) =>
      name.toLowerCase() === "content-length" ? contentLength : ""
    ),
    set: vi.fn((name: string, value: string) => {
      headers.set(name.toLowerCase(), value);
    }),
    badRequest: vi.fn((message: string) => ({
      data: null,
      error: {
        status: 400,
        name: "BadRequestError",
        message,
        details: {},
      },
    })),
    headerValue(name: string) {
      return headers.get(name.toLowerCase());
    },
  };
};

const validBody = (email = "user@example.com") => ({
  email,
  consent: true,
  source: "website-footer",
  preferredLanguage: "cs",
  consentVersion: "2026-07-10",
  sourceRef: "/newsletter",
});

describe("newsletter subscribe controller", () => {
  it("returns 413 for oversized payloads before storing anything", async () => {
    const { controller, subscribe } = await loadController();
    const ctx = makeCtx(validBody(), "9000");

    const response = await controller.subscribe(ctx);

    expect(ctx.status).toBe(413);
    expect(response).toMatchObject({
      error: {
        status: 413,
        name: "PayloadTooLargeError",
      },
    });
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("returns 429 with Retry-After after repeated attempts for one email", async () => {
    const { controller, subscribe } = await loadController({
      NEWSLETTER_EMAIL_RATE_LIMIT_HOUR_MAX: "2",
      NEWSLETTER_EMAIL_RATE_LIMIT_DAY_MAX: "0",
    });

    expect(await controller.subscribe(makeCtx(validBody()))).toEqual({
      data: { ok: true },
    });
    expect(await controller.subscribe(makeCtx(validBody()))).toEqual({
      data: { ok: true },
    });

    const limitedCtx = makeCtx(validBody());
    const response = await controller.subscribe(limitedCtx);

    expect(limitedCtx.status).toBe(429);
    expect(Number(limitedCtx.headerValue("Retry-After"))).toBeGreaterThan(0);
    expect(response).toMatchObject({
      error: {
        status: 429,
        name: "TooManyRequestsError",
      },
    });
    expect(subscribe).toHaveBeenCalledTimes(2);
  });

  it("gives honeypot submissions neutral success without validating or storing", async () => {
    const { controller, subscribe } = await loadController();
    const ctx = makeCtx({
      email: "not-an-email",
      consent: false,
      website: "https://bot.example",
    });

    await expect(controller.subscribe(ctx)).resolves.toEqual({
      data: { ok: true },
    });
    expect(ctx.badRequest).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("does not accept the core REST data envelope for this custom endpoint", async () => {
    const { controller, subscribe } = await loadController();
    const ctx = makeCtx({ data: validBody() });

    const response = await controller.subscribe(ctx);

    expect(ctx.badRequest).toHaveBeenCalledWith("Consent is required");
    expect(response).toMatchObject({
      error: {
        status: 400,
        message: "Consent is required",
      },
    });
    expect(subscribe).not.toHaveBeenCalled();
  });
});
