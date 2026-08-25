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

    const result = lifecycles.beforeUpdate({
      params: { data, where: { id: 1 } },
    });
    await expect(result).rejects.toThrow("source_locale is immutable");
    await expect(result).rejects.toMatchObject({ name: "ValidationError" });
  });

  it("does not fail an unrelated update when a legacy row has a null source", async () => {
    installStrapi(null);
    const data: Record<string, unknown> = {
      description: "Updated description",
      source_locale: null,
    };

    await lifecycles.beforeUpdate({ params: { data, where: { id: 1 } } });

    expect(data).toEqual({ description: "Updated description" });
  });

  it("prevents a stale null sync from erasing an established source", async () => {
    installStrapi("cs");
    const data: Record<string, unknown> = { source_locale: null };

    await lifecycles.beforeUpdate({ params: { data, where: { id: 1 } } });

    expect(data.source_locale).toBe("cs");
  });

  it("allows an explicit valid backfill when the legacy source is null", async () => {
    installStrapi(null);
    const data: Record<string, unknown> = { source_locale: "en_us" };

    await lifecycles.beforeUpdate({ params: { data, where: { id: 1 } } });

    expect(data.source_locale).toBe("en-US");
  });
});
