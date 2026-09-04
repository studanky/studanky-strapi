import { afterEach, describe, expect, it, vi } from "vitest";
import lifecycles from "../../src/api/spring/content-types/spring/lifecycles";

const originalStrapi = (globalThis as Record<string, unknown>).strapi;

function installStrapi(
  options: {
    existingSources?: Array<string | null>;
    configured?: string[];
    defaultLocale?: string;
  } = {},
) {
  const { existingSources, configured = ["cs", "en", "en-US"] } = options;
  const findOne = vi.fn(async () =>
    existingSources === undefined
      ? null
      : { source_locale: existingSources[0] ?? null },
  );
  const findMany = vi.fn(async () =>
    (existingSources ?? []).map((source_locale) => ({ source_locale })),
  );
  (globalThis as Record<string, unknown>).strapi = {
    db: { query: () => ({ findOne, findMany }) },
    plugin: () => ({
      service: () => ({
        getDefaultLocale: async () => options.defaultLocale ?? "cs",
        find: async () => configured.map((code) => ({ code })),
      }),
    }),
  };
  return { findOne, findMany };
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
      locale: "cs",
    };

    await lifecycles.beforeCreate({ params: { data } });

    expect(data.source_locale).toBe("cs");
  });

  it("rejects creating a ČHMÚ document outside its Czech source locale", async () => {
    installStrapi();
    const data: Record<string, unknown> = {
      name: "Žofínský pramen",
      external_source: "chmu",
      locale: "en-US",
    };

    const result = lifecycles.beforeCreate({ params: { data } });

    await expect(result).rejects.toThrow(
      "ČHMÚ Springs must be created in locale cs",
    );
    await expect(result).rejects.toMatchObject({ name: "ValidationError" });
  });

  it("uses and canonicalizes the first manually created locale", async () => {
    installStrapi();
    const data: Record<string, unknown> = { name: "Spring", locale: "EN-us" };

    await lifecycles.beforeCreate({ params: { data } });

    expect(data.source_locale).toBe("en-US");
  });

  it("rejects a legacy underscore locale", async () => {
    installStrapi();
    const data: Record<string, unknown> = { name: "Spring", locale: "en_US" };

    await expect(lifecycles.beforeCreate({ params: { data } })).rejects.toThrow(
      "creation locale must be a valid locale code",
    );
  });

  it("preserves the source when another localization row is created", async () => {
    installStrapi({ existingSources: ["cs", "cs"] });
    const data: Record<string, unknown> = {
      documentId: "spring-1",
      locale: "en-US",
    };

    await lifecycles.beforeCreate({ params: { data } });

    expect(data.source_locale).toBe("cs");
  });

  it("rejects an explicit source that conflicts with the existing document", async () => {
    installStrapi({ existingSources: ["cs"] });
    const data: Record<string, unknown> = {
      documentId: "spring-1",
      locale: "en-US",
      source_locale: "en-US",
    };

    const result = lifecycles.beforeCreate({ params: { data } });

    await expect(result).rejects.toThrow(
      "source_locale is immutable across document localizations",
    );
    await expect(result).rejects.toMatchObject({ name: "ValidationError" });
  });

  it("rejects conflicting source values already stored across physical rows", async () => {
    installStrapi({ existingSources: ["cs", "en"] });
    const data: Record<string, unknown> = {
      documentId: "spring-1",
      locale: "en-US",
    };

    await expect(lifecycles.beforeCreate({ params: { data } })).rejects.toThrow(
      "conflicting source_locale values",
    );
  });

  it("rejects a localization create when an existing row has no source", async () => {
    installStrapi({ existingSources: [null] });
    const data: Record<string, unknown> = {
      documentId: "spring-1",
      locale: "en-US",
    };

    await expect(lifecycles.beforeCreate({ params: { data } })).rejects.toThrow(
      "source_locale must be a valid locale code",
    );
  });

  it("rejects an explicit source that differs from a new document's locale", async () => {
    installStrapi();
    const data: Record<string, unknown> = {
      name: "Spring",
      locale: "en-US",
      source_locale: "cs",
    };

    await expect(lifecycles.beforeCreate({ params: { data } })).rejects.toThrow(
      "must equal its creation locale",
    );
  });

  it("rejects source locales that are not configured in Strapi", async () => {
    installStrapi({ configured: ["cs", "en"] });
    const data: Record<string, unknown> = { name: "Quelle", locale: "de" };

    await expect(lifecycles.beforeCreate({ params: { data } })).rejects.toThrow(
      "creation locale must be configured in Strapi i18n",
    );
  });

  it("rejects changing the source locale after creation", async () => {
    installStrapi({ existingSources: ["cs"] });
    const data: Record<string, unknown> = { source_locale: "en" };

    const result = lifecycles.beforeUpdate({
      params: { data, where: { id: 1 } },
    });
    await expect(result).rejects.toThrow("source_locale is immutable");
    await expect(result).rejects.toMatchObject({ name: "ValidationError" });
  });

  it("rejects updates when the persisted source locale is missing", async () => {
    installStrapi({ existingSources: [null] });
    const data: Record<string, unknown> = {
      description: "Updated description",
      source_locale: null,
    };

    await expect(
      lifecycles.beforeUpdate({ params: { data, where: { id: 1 } } }),
    ).rejects.toThrow("repair the document before updating it");
  });

  it("rejects a null source update", async () => {
    installStrapi({ existingSources: ["cs"] });
    const data: Record<string, unknown> = { source_locale: null };

    await expect(
      lifecycles.beforeUpdate({ params: { data, where: { id: 1 } } }),
    ).rejects.toThrow("source_locale must be a valid locale code");
  });
});
