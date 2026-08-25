import { afterEach, describe, expect, it, vi } from "vitest";
import lifecycles from "../../src/api/spring/content-types/spring/lifecycles";

const originalStrapi = (globalThis as Record<string, unknown>).strapi;

function installStrapi(existingSource?: string | null) {
  const findOne = vi.fn(async () =>
    existingSource === undefined ? null : { source_locale: existingSource },
  );
  (globalThis as Record<string, unknown>).strapi = {
    contentTypes: {
      "api::spring.spring": { attributes: { name_search: {} } },
    },
    db: { query: () => ({ findOne }) },
    plugin: () => ({
      service: () => ({ getDefaultLocale: async () => "cs" }),
    }),
  };
  return { findOne };
}

afterEach(() => {
  (globalThis as Record<string, unknown>).strapi = originalStrapi;
});

describe("Spring source_locale lifecycle invariant", () => {
  it("assigns Czech to a newly imported ČHMÚ document", async () => {
    installStrapi();
    const data: Record<string, unknown> = {
      name: "Žofínský pramen",
      external_source: "chmu",
      locale: "en-US",
    };

    await lifecycles.beforeCreate({ params: { data } });

    expect(data.source_locale).toBe("cs");
  });

  it("uses and canonicalizes the first manually created locale", async () => {
    installStrapi();
    const data: Record<string, unknown> = { name: "Spring", locale: "en_us" };

    await lifecycles.beforeCreate({ params: { data } });

    expect(data.source_locale).toBe("en-US");
  });

  it("preserves the source when another localization row is created", async () => {
    installStrapi("cs");
    const data: Record<string, unknown> = {
      documentId: "spring-1",
      locale: "en-US",
    };

    await lifecycles.beforeCreate({ params: { data } });

    expect(data.source_locale).toBe("cs");
  });

  it("rejects changing the source locale after creation", async () => {
    installStrapi("cs");
    const data: Record<string, unknown> = { source_locale: "en" };

    await expect(
      lifecycles.beforeUpdate({ params: { data, where: { id: 1 } } }),
    ).rejects.toThrow("source_locale is immutable");
  });
});
