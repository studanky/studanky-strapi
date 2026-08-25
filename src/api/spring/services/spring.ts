/**
 * spring service
 */

import { factories } from "@strapi/strapi";
import type { Core } from "@strapi/strapi";
import {
  listSpringStations,
  fetchLatestValue,
  fetchRecentValue,
  recentMonths,
} from "./chmu-client";
import { mapWithConcurrency } from "../../../utils/concurrency";
import { haversineMeters, isValidOrigin } from "../../../utils/geo";
import { normalizeSearchText } from "../../../utils/search";
import {
  canonicalizeLocaleTag,
  resolveLocaleChain,
  type PreferredLocaleVariants,
} from "../../../utils/locale";

const SPRING_UID = "api::spring.spring";

/** Search tuning. */
const SEARCH_MIN_QUERY = 2; // ignore 0–1 char noise
const SEARCH_MAX_QUERY = 80;
const SEARCH_DEFAULT_LIMIT = 10;
const SEARCH_MAX_LIMIT = 50;
const SEARCH_CANDIDATE_CAP = 200; // bounds the JS distance sort on broad queries
const SOURCE_FALLBACK_LOG_SAMPLE_LIMIT = 10;
const REPORT_UID = "api::report.report";
const CONFIG_UID = "api::platform-config.platform-config";
const CHMU_SOURCE = "chmu";
// ČHMÚ station metadata is Czech source content. This is deliberately
// independent of Strapi's mutable global default locale.
const CHMU_SOURCE_LOCALE = "cs";

type SpringStatus = "is_flowing" | "is_not_flowing" | "unknown";

interface LatestReport {
  is_flowing: boolean;
  flow_scale: number | null;
  flow_rate_lps: number | null;
  reported_at: string;
}

interface I18nLocale {
  code: string;
}

interface LocalizedSpringRow {
  documentId: string;
  locale: string;
  source_locale: string | null;
  [key: string]: unknown;
}

interface SourceFallbackIssue {
  documentId: string;
  error: Error;
}

/** The published Spring row shape read by `preview` (teaser fields only). */
interface SpringPreviewRow {
  documentId: string;
  name: string;
  lat: number | string;
  lng: number | string;
  description: string | null;
  current_status: SpringStatus;
  status_updated_at: string | null;
  photo?: {
    url: string;
    alternativeText?: string | null;
    width?: number | null;
    height?: number | null;
    formats?: Record<string, { url: string }> | null;
  } | null;
}

/** Resolves the configured default locale dynamically. Failures stay visible. */
async function getDefaultLocale(strapi: Core.Strapi): Promise<string> {
  const code = await strapi
    .plugin("i18n")
    .service("locales")
    .getDefaultLocale();

  if (!code) {
    throw new Error("Strapi i18n default locale is not configured");
  }

  return code;
}

/** Resolves all configured locale codes. Failures stay visible. */
async function getConfiguredLocales(strapi: Core.Strapi): Promise<string[]> {
  const locales = (await strapi
    .plugin("i18n")
    .service("locales")
    .find()) as I18nLocale[];
  const codes = locales.map((locale) => locale.code).filter(Boolean);
  if (codes.length === 0) {
    throw new Error("Strapi i18n has no configured locales");
  }
  return codes;
}

function getPreferredLocaleVariants(
  strapi: Core.Strapi,
): PreferredLocaleVariants {
  const configured = strapi.config?.get(
    "locale-fallbacks.preferredVariants",
    {},
  );
  if (
    !configured ||
    typeof configured !== "object" ||
    Array.isArray(configured)
  ) {
    return {};
  }
  return configured as PreferredLocaleVariants;
}

interface SpringSourceMetadata {
  documentExists: boolean;
  locale: string | null;
}

type LocaleCanonicalizer = (locale: string) => string | null;

function indexConfiguredLocales(
  configured: string[],
  canonicalize: LocaleCanonicalizer = canonicalizeLocaleTag,
): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const locale of configured) {
    const canonical = canonicalize(locale);
    if (!canonical) {
      throw new Error(`Strapi i18n locale ${locale} is invalid`);
    }
    lookup.set(canonical, locale);
  }
  return lookup;
}

function findConfiguredLocale(
  locale: string,
  configuredByCanonical: ReadonlyMap<string, string>,
  canonicalize: LocaleCanonicalizer = canonicalizeLocaleTag,
): string | undefined {
  const canonical = canonicalize(locale);
  return canonical ? configuredByCanonical.get(canonical) : undefined;
}

async function getSpringSourceMetadata(
  strapi: Core.Strapi,
  documentId: string,
): Promise<SpringSourceMetadata> {
  const row = (await strapi.db.query(SPRING_UID).findOne({
    where: { documentId },
    select: ["documentId", "source_locale"],
    orderBy: { id: "asc" },
  })) as { documentId: string; source_locale?: string | null } | null;

  if (!row) {
    return { documentExists: false, locale: null };
  }
  return { documentExists: true, locale: row.source_locale ?? null };
}

/**
 * Resolves the usable read chain first, then appends source metadata only when
 * valid. Source metadata improves fallback resilience but never gates an
 * otherwise readable requested/default variant.
 */
function resolveSpringReadLocales(params: {
  strapi: Core.Strapi;
  endpoint: "detail" | "preview";
  documentId: string;
  requested?: string;
  defaultLocale: string;
  configured: string[];
  preferredVariants: PreferredLocaleVariants;
  source: SpringSourceMetadata;
}): string[] {
  const {
    strapi,
    endpoint,
    documentId,
    requested,
    defaultLocale,
    configured,
    preferredVariants,
    source,
  } = params;
  const baseAttempts = resolveLocaleChain({
    requested,
    defaultLocale,
    configured,
    preferredVariants,
  });

  if (!source.documentExists) {
    return baseAttempts;
  }
  if (!source.locale) {
    strapi.log.error(
      `spring.${endpoint}: document ${documentId} has no source_locale; continuing without source fallback`,
    );
    return baseAttempts;
  }

  const configuredSource = findConfiguredLocale(
    source.locale,
    indexConfiguredLocales(configured),
  );
  if (!configuredSource) {
    strapi.log.error(
      `spring.${endpoint}: invalid source_locale for document ${documentId}: ${source.locale} is not configured in Strapi i18n; continuing without source fallback`,
    );
    return baseAttempts;
  }

  return [...new Set([...baseAttempts, configuredSource])];
}

function logSourceFallbackIssues(
  strapi: Core.Strapi,
  endpoint: "map" | "search",
  issues: SourceFallbackIssue[],
): void {
  if (issues.length === 0) {
    return;
  }

  const shown = issues.slice(0, SOURCE_FALLBACK_LOG_SAMPLE_LIMIT);
  const details = shown
    .map(({ documentId, error }) => `${documentId} (${error.message})`)
    .join("; ");
  const omitted = issues.length - shown.length;
  const suffix =
    omitted > 0
      ? ` (+${omitted} more; see the source-locale audit query in database-migrations.md)`
      : "";
  strapi.log.error(
    `spring.${endpoint}: ${issues.length} document(s) without usable source_locale fallback; continuing with requested/default chain: ${details}${suffix}`,
  );
}

/**
 * Chooses at most one complete published row per document. Selection is based
 * solely on row existence; individual field values (including a null localized
 * description) never trigger another fallback attempt.
 */
function selectLocalizedSpringRows<T extends LocalizedSpringRow>(params: {
  rows: T[];
  requested?: string;
  defaultLocale: string;
  configured: string[];
  preferredVariants: PreferredLocaleVariants;
}): {
  rows: Array<Omit<T, "source_locale">>;
  sourceFallbackIssues: SourceFallbackIssue[];
} {
  const { rows, requested, defaultLocale, configured, preferredVariants } =
    params;

  // Validate request-wide i18n configuration before processing individual
  // documents. A broken global default/configured locale list must stay a
  // visible server error rather than degrading into an empty map.
  const baseAttempts = resolveLocaleChain({
    requested,
    defaultLocale,
    configured,
    preferredVariants,
  });

  // Locale parsing is synchronous ICU work. Cache it for this request so the
  // hot map/search path does not repeat it for every physical locale row.
  const canonicalCache = new Map<string, string | null>();
  const canonicalizeCached = (value: string): string | null => {
    if (!canonicalCache.has(value)) {
      canonicalCache.set(value, canonicalizeLocaleTag(value));
    }
    return canonicalCache.get(value) ?? null;
  };
  const configuredByCanonical = indexConfiguredLocales(
    configured,
    canonicalizeCached,
  );
  const attemptsBySource = new Map<string, string[]>();

  const byDocument = new Map<string, T[]>();
  for (const row of rows) {
    const group = byDocument.get(row.documentId) ?? [];
    group.push(row);
    byDocument.set(row.documentId, group);
  }

  const selected: Array<Omit<T, "source_locale">> = [];
  const sourceFallbackIssues: SourceFallbackIssue[] = [];
  for (const [documentId, variants] of byDocument) {
    let attempts = baseAttempts;
    try {
      const canonicalSources = variants.map((row) =>
        row.source_locale ? canonicalizeCached(row.source_locale) : null,
      );
      const sourceLocales = [
        ...new Set(canonicalSources.filter((locale) => locale !== null)),
      ];
      if (
        canonicalSources.some((locale) => locale === null) ||
        sourceLocales.length !== 1
      ) {
        throw new Error(
          `must have one valid source_locale on every locale row; found ${sourceLocales.length} distinct values`,
        );
      }

      const sourceLocale = sourceLocales[0];
      const configuredSource = findConfiguredLocale(
        sourceLocale,
        configuredByCanonical,
        canonicalizeCached,
      );
      if (!configuredSource) {
        throw new Error(
          `source_locale ${sourceLocale} is not configured in Strapi i18n`,
        );
      }

      const cachedAttempts = attemptsBySource.get(configuredSource);
      if (cachedAttempts) {
        attempts = cachedAttempts;
      } else {
        attempts = [...new Set([...baseAttempts, configuredSource])];
        attemptsBySource.set(configuredSource, attempts);
      }
    } catch (error) {
      const cause = error instanceof Error ? error : new Error(String(error));
      sourceFallbackIssues.push({ documentId, error: cause });
    }

    const variantsByLocale = new Map(
      variants.map((row) => [canonicalizeCached(row.locale), row]),
    );
    const row = attempts
      .map((locale) => variantsByLocale.get(canonicalizeCached(locale)))
      .find((candidate): candidate is T => Boolean(candidate));
    if (row) {
      const { source_locale: _sourceLocale, ...publicRow } = row;
      selected.push(publicRow as Omit<T, "source_locale">);
    }
  }
  return { rows: selected, sourceFallbackIssues };
}

function hasNameSearchField(strapi: Core.Strapi): boolean {
  const attributes = strapi.contentTypes[SPRING_UID]?.attributes as
    | Record<string, unknown>
    | undefined;
  return Boolean(attributes?.["name_search"]);
}

function springDataWithSearchName<T extends Record<string, unknown>>(
  strapi: Core.Strapi,
  data: T,
): T & { name_search?: string } {
  if (hasNameSearchField(strapi) && typeof data.name === "string") {
    return { ...data, name_search: normalizeSearchText(data.name) };
  }

  return data;
}

export default factories.createCoreService(SPRING_UID, ({ strapi }) => ({
  /**
   * Denormalization — the single source of truth for a Spring's cached status.
   *
   * Recomputes `current_status`, `status_updated_at`, `last_flow_scale` and
   * `last_flow_rate_lps` from the Spring's newest Report (by `reported_at`) and
   * writes them onto the Spring. Idempotent: always derives from the latest
   * report, so it is safe to call repeatedly / from multiple paths.
   *
   * Called explicitly by ČHMÚ sync and (Phase 2) report submit — NOT from a
   * lifecycle hook (invariant: denormalization happens only here).
   *
   * Spring keeps Draft & Publish (the map reads the published row). We write the
   * draft AND published rows in one raw `db.query` update with the same
   * `updatedAt`, so both rows stay identical → the entry remains "Published"
   * (no spurious "Modified" badge). Using `db.query` also bypasses the Document
   * Service, so unrelated uncommitted draft edits to OTHER fields are preserved
   * and never auto-published.
   */
  async refreshLatest(springDocumentId: string): Promise<void> {
    if (!springDocumentId) {
      return;
    }

    // 1) Newest report for this spring (newest-wins).
    const reports = (await strapi.documents(REPORT_UID).findMany({
      filters: { spring: { documentId: springDocumentId } },
      sort: { reported_at: "desc" },
      limit: 1,
      fields: ["is_flowing", "flow_scale", "flow_rate_lps", "reported_at"],
    })) as unknown as LatestReport[];

    const latest = reports[0];
    if (!latest) {
      // No reports yet → nothing to denormalize.
      return;
    }

    const newStatus: SpringStatus = latest.is_flowing
      ? "is_flowing"
      : "is_not_flowing";

    const data = {
      current_status: newStatus,
      status_updated_at: latest.reported_at,
      last_flow_scale: latest.flow_scale ?? null,
      last_flow_rate_lps: latest.flow_rate_lps ?? null,
    };

    // 2) Update BOTH the draft and published rows in a single raw update with
    //    the same updatedAt → rows stay in sync, entry stays "Published".
    await strapi.db.query(SPRING_UID).updateMany({
      where: { documentId: springDocumentId },
      data: { ...data, updatedAt: new Date().toISOString() },
    });

    strapi.log.debug(
      `refreshLatest: Spring ${springDocumentId} → ${newStatus} (draft+published)`,
    );
  },

  /**
   * Map query — returns only the minimal PUBLIC fields needed to render markers
   * within a bounding box. No report history, no private data. Reads published
   * locale rows once, then selects exactly one whole variant per document.
   *
   * @param bbox "minLng,minLat,maxLng,maxLat"
   */
  async findInBbox(bbox: string | undefined, requestedLocale?: string) {
    if (!bbox || typeof bbox !== "string") {
      return [];
    }
    const [minLng, minLat, maxLng, maxLat] = bbox.split(",").map(Number);
    if ([minLng, minLat, maxLng, maxLat].some((n) => Number.isNaN(n))) {
      return [];
    }

    const [defaultLocale, configured] = await Promise.all([
      getDefaultLocale(strapi),
      getConfiguredLocales(strapi),
    ]);
    const rows = (await strapi.db.query(SPRING_UID).findMany({
      where: {
        lat: { $gte: minLat, $lte: maxLat },
        lng: { $gte: minLng, $lte: maxLng },
        publishedAt: { $notNull: true },
        locale: { $in: configured },
      },
      // Explicit allowlist: Query Engine is used to load all locale rows in one
      // query, then one whole row per document is selected below.
      select: [
        "documentId",
        "name",
        "lat",
        "lng",
        "current_status",
        "status_updated_at",
        "locale",
        "source_locale",
      ],
    })) as LocalizedSpringRow[];

    const selection = selectLocalizedSpringRows({
      rows,
      requested: requestedLocale,
      defaultLocale,
      configured,
      preferredVariants: getPreferredLocaleVariants(strapi),
    });
    logSourceFallbackIssues(strapi, "map", selection.sourceFallbackIssues);
    return selection.rows;
  },

  /**
   * Search — name autocomplete for the map search box. The user types a query,
   * picks a result, and the client flies the map to that spring's coordinates.
   *
   * Returns the same minimal, map-safe field set as `findInBbox` (so a result
   * can be rendered as a marker straight away) plus, when the client passes a
   * valid origin (`lat`/`lng` — user location or map centre), a rounded
   * `distance_m` and proximity ordering ("nearest first"). Without an origin,
   * results are alphabetical.
   *
   * Searches every published locale row because the official Spring name is
   * canonical and non-localized, deduplicates by documentId, then chooses one
   * whole variant with the shared locale fallback. Name match is case-insensitive,
   * accent-insensitive when the internal `name_search` field exists, and partial
   * (`$containsi`). A candidate cap bounds the in-JS distance sort on broad
   * queries; queries shorter than `SEARCH_MIN_QUERY` return [].
   */
  async search(params: {
    q?: string;
    lat?: number;
    lng?: number;
    limit?: number;
    locale?: string;
  }) {
    const rawQ = (params.q ?? "").trim().slice(0, SEARCH_MAX_QUERY);
    const searchByNormalizedName = hasNameSearchField(strapi);
    const q = searchByNormalizedName ? normalizeSearchText(rawQ) : rawQ;
    if (q.length < SEARCH_MIN_QUERY) {
      return [];
    }

    const requestedLimit = Number.isFinite(params.limit as number)
      ? (params.limit as number)
      : SEARCH_DEFAULT_LIMIT;
    const limit = Math.min(Math.max(1, requestedLimit), SEARCH_MAX_LIMIT);
    const [defaultLocale, configured] = await Promise.all([
      getDefaultLocale(strapi),
      getConfiguredLocales(strapi),
    ]);
    const searchField = searchByNormalizedName ? "name_search" : "name";

    const rows = (await strapi.db.query(SPRING_UID).findMany({
      where: {
        [searchField]: { $containsi: q },
        publishedAt: { $notNull: true },
        locale: { $in: configured },
      },
      // Same allowlist as the bbox map path — no history, no private data.
      select: [
        "documentId",
        "name",
        "lat",
        "lng",
        "current_status",
        "status_updated_at",
        "locale",
        "source_locale",
      ],
      orderBy: { name: "asc" },
      // The semantic cap is applied after locale rows are deduplicated. This
      // physical cap leaves room for every configured localization per result.
      limit: SEARCH_CANDIDATE_CAP * Math.max(1, configured.length),
    })) as LocalizedSpringRow[];
    const selection = selectLocalizedSpringRows({
      rows,
      requested: params.locale,
      defaultLocale,
      configured,
      preferredVariants: getPreferredLocaleVariants(strapi),
    });
    logSourceFallbackIssues(strapi, "search", selection.sourceFallbackIssues);
    const candidates = selection.rows.slice(0, SEARCH_CANDIDATE_CAP) as Array<
      Omit<LocalizedSpringRow, "source_locale"> & {
        lat: number | string;
        lng: number | string;
      }
    >;

    if (!isValidOrigin(params.lat, params.lng)) {
      return candidates.slice(0, limit);
    }

    return (
      candidates
        .map((s) => ({
          ...s,
          distance_m: Math.round(
            haversineMeters(
              params.lat as number,
              params.lng as number,
              Number(s.lat),
              Number(s.lng),
            ),
          ),
        }))
        // Rows with an unparseable coordinate sink to the bottom.
        .sort(
          (a, b) =>
            (Number.isNaN(a.distance_m) ? Infinity : a.distance_m) -
            (Number.isNaN(b.distance_m) ? Infinity : b.distance_m),
        )
        .slice(0, limit)
    );
  },

  /**
   * Core-detail lookup with document-level locale fallback while preserving
   * the sanitized core query (`fields`, `populate`, `status`, ...).
   */
  async findOneWithLocaleFallback(
    documentId: string,
    params: Record<string, any> = {},
  ) {
    const requestedLocale =
      typeof params.locale === "string" ? params.locale : undefined;
    const { locale: _locale, ...query } = params;
    const [defaultLocale, configured, source] = await Promise.all([
      getDefaultLocale(strapi),
      getConfiguredLocales(strapi),
      getSpringSourceMetadata(strapi, documentId),
    ]);
    const attempts = resolveSpringReadLocales({
      strapi,
      endpoint: "detail",
      documentId,
      requested: requestedLocale,
      defaultLocale,
      configured,
      preferredVariants: getPreferredLocaleVariants(strapi),
      source,
    });

    for (const locale of attempts) {
      const entity = await strapi.documents(SPRING_UID).findOne({
        ...query,
        documentId,
        status: query.status ?? "published",
        locale,
      });
      if (entity) {
        return entity;
      }
    }

    return null;
  },

  /**
   * Paginated report history for a Spring (lazy-loaded detail view).
   *
   * Returns an explicit PUBLIC field allowlist — private capture data
   * (`user_lat`, `user_lng`) and internal `device_id` are never fetched, so
   * they cannot leak regardless of controller-level sanitization.
   */
  async history(documentId: string, page = 1, pageSize = 20) {
    const safePage = Math.max(1, page);
    const safePageSize = Math.min(Math.max(1, pageSize), 100);
    const start = (safePage - 1) * safePageSize;
    const filters = { spring: { documentId } };

    const [data, total] = await Promise.all([
      strapi.documents(REPORT_UID).findMany({
        filters,
        sort: { reported_at: "desc" },
        start,
        limit: safePageSize,
        fields: [
          "is_flowing",
          "flow_scale",
          "flow_rate_lps",
          "has_odor",
          "water_clarity",
          "note",
          "reported_at",
          "source_type",
        ],
      }),
      strapi.documents(REPORT_UID).count({ filters }),
    ]);

    return {
      data,
      pagination: {
        page: safePage,
        pageSize: safePageSize,
        total,
        pageCount: Math.ceil(total / safePageSize),
      },
    };
  },

  /**
   * Preview — a deliberately minimal PUBLIC subset of a Spring for the web
   * "share" page. When a user shares a spring with someone who does NOT have the
   * app installed, the deep link falls back to the web; this endpoint feeds that
   * preview with a call-to-action to install the app for the full detail.
   *
   * TEASER BOUNDARY (spec §3, §11): returns only fields that live directly on
   * the Spring object — name, coordinates, description, photo, whether it
   * currently flows (`current_status`) and when that was last updated
   * (`status_updated_at`). It withholds the app's core value: flow STRENGTH
   * (`last_flow_scale` / `last_flow_rate_lps`), water clarity/odor, and the full
   * report history all stay app-only, so the visitor is motivated to install.
   *
   * The web just shows the raw status + "last updated" timestamp and links to
   * the app for more — no server-side freshness/staleness verdict (the tri-state
   * "stale" rule stays a client concern, as on `/map` and `/search`).
   *
   * Optionality mirrors the Spring schema: `name`, `lat`, `lng` and
   * `current_status` are required (always present); `status_updated_at`,
   * `description` and `photo` are optional (null when unset — the web handles
   * missing values, notably the not-yet-sent photo).
   *
   * Locale fallback: a shared web link must not die because of language. We
   * build an ordered attempt list with `resolveSpringReadLocales` — exact
   * requested locale, its parents/same-language variants, default and source
   * locale — and query each until one hits. So an unsupported/garbage locale
   * from a share URL is never passed to the Document Service (behaviour never
   * depends on how it reacts to an unknown locale), and a spring published only
   * in the default locale is still served. A Spring missing/unpublished in every
   * attempted locale yields null → the controller answers 404. The actually
   * served locale is returned as `locale` so the web knows which language it got.
   */
  async preview(documentId: string, locale?: string) {
    if (!documentId) {
      return null;
    }

    const [defaultLocale, configured, source] = await Promise.all([
      getDefaultLocale(strapi),
      getConfiguredLocales(strapi),
      getSpringSourceMetadata(strapi, documentId),
    ]);
    const attempts = resolveSpringReadLocales({
      strapi,
      endpoint: "preview",
      documentId,
      requested: locale,
      defaultLocale,
      configured,
      preferredVariants: getPreferredLocaleVariants(strapi),
      source,
    });

    const queryPreview = (loc: string) =>
      strapi.documents(SPRING_UID).findOne({
        documentId,
        status: "published",
        locale: loc,
        // Spring-object fields only — NO flow strength (last_flow_scale /
        // last_flow_rate_lps) and NO report history; those stay app-only.
        fields: [
          "name",
          "lat",
          "lng",
          "description",
          "current_status",
          "status_updated_at",
        ],
        populate: {
          photo: {
            fields: ["url", "alternativeText", "width", "height", "formats"],
          },
        },
      }) as Promise<SpringPreviewRow | null>;

    let served: { spring: SpringPreviewRow; locale: string } | null = null;
    for (const loc of attempts) {
      const row = await queryPreview(loc);
      if (row) {
        served = { spring: row, locale: loc };
        break;
      }
    }

    if (!served) {
      return null;
    }
    const { spring, locale: servedLocale } = served;

    const photo = spring.photo
      ? {
          url: spring.photo.url,
          alternativeText: spring.photo.alternativeText ?? null,
          width: spring.photo.width ?? null,
          height: spring.photo.height ?? null,
          // A small format for share cards / OG images, when available.
          thumbnail_url: spring.photo.formats?.thumbnail?.url ?? null,
        }
      : null;

    // Required in the schema → always present. Optional → null when unset.
    return {
      documentId: spring.documentId,
      name: spring.name,
      lat: spring.lat,
      lng: spring.lng,
      current_status: spring.current_status,
      status_updated_at: spring.status_updated_at ?? null,
      description: spring.description ?? null,
      photo,
      locale: servedLocale,
    };
  },

  /**
   * ČHMÚ sync — upserts canonical station metadata in the Czech source locale
   * only and appends a fresh discharge report when ČHMÚ has newer data, then
   * denormalizes via refreshLatest.
   *
   * Source-neutral: the ČHMÚ adapter (`chmu-client`) yields neutral DTOs; this
   * method maps them onto the canonical model (external_source = 'chmu'). Each
   * station is isolated in try/catch so one bad object never aborts the run;
   * value downloads are concurrency-limited (~hundreds of files / night).
   */
  async syncFromChmu() {
    const [defaultLocale, locales] = await Promise.all([
      getDefaultLocale(strapi),
      getConfiguredLocales(strapi),
    ]);

    if (!locales.includes(CHMU_SOURCE_LOCALE)) {
      throw new Error(
        `ČHMÚ sync requires configured source locale ${CHMU_SOURCE_LOCALE}`,
      );
    }

    const stations = await listSpringStations();

    const stats = {
      stations: stations.length,
      locales,
      default_locale: defaultLocale,
      sync_locale: CHMU_SOURCE_LOCALE,
      created: 0,
      updated: 0,
      localized_created: 0,
      localized_updated: 0,
      reports: 0,
      recent: 0, // values that came from the recent/ fallback (not now/)
      skipped: 0,
      errors: 0,
    };

    // Phase A — upsert canonical station metadata in Czech only (sequential;
    // SQLite-friendly writes). Existing translations
    // are never created or published by the source import.
    const targets: Array<{
      documentId: string;
      externalId: string;
      lastReportAt: string | null;
    }> = [];

    for (const st of stations) {
      try {
        const existingDocument = (await strapi.db.query(SPRING_UID).findOne({
          where: {
            external_source: CHMU_SOURCE,
            external_id: st.externalId,
            publishedAt: null,
          },
          select: ["documentId", "status_updated_at", "source_locale"],
          orderBy: { locale: "asc" },
        })) as {
          documentId: string;
          status_updated_at: string | null;
          source_locale: string | null;
        } | null;

        let documentId = existingDocument?.documentId ?? null;
        const stationWasCreated = !documentId;

        if (!documentId) {
          const created = await strapi.documents(SPRING_UID).create({
            data: springDataWithSearchName(strapi, {
              name: st.name,
              lat: st.lat,
              lng: st.lng,
              external_source: CHMU_SOURCE,
              external_id: st.externalId,
              source_locale: CHMU_SOURCE_LOCALE,
              current_status: "unknown",
            }),
            locale: CHMU_SOURCE_LOCALE,
          });
          documentId = created.documentId;
        } else {
          if (existingDocument?.source_locale !== CHMU_SOURCE_LOCALE) {
            throw new Error(
              `Spring ${documentId} has source_locale ${existingDocument?.source_locale ?? "null"}; expected ${CHMU_SOURCE_LOCALE} for ČHMÚ`,
            );
          }

          const existingCzech = (await strapi.db.query(SPRING_UID).findOne({
            where: {
              documentId,
              locale: CHMU_SOURCE_LOCALE,
              publishedAt: null,
            },
            select: ["id"],
          })) as { id: number } | null;

          if (!existingCzech) {
            throw new Error(
              `Spring ${documentId} has no draft in ČHMÚ source locale ${CHMU_SOURCE_LOCALE}`,
            );
          }

          await strapi.documents(SPRING_UID).update({
            documentId,
            data: springDataWithSearchName(strapi, {
              name: st.name,
              lat: st.lat,
              lng: st.lng,
              external_source: CHMU_SOURCE,
              external_id: st.externalId,
            }),
            locale: CHMU_SOURCE_LOCALE,
          });
          stats.localized_updated++;
        }

        if (!documentId) {
          throw new Error(`No documentId resolved for ${st.externalId}`);
        }

        if (stationWasCreated) {
          stats.localized_created++;
        }

        await strapi.documents(SPRING_UID).publish({
          documentId,
          locale: CHMU_SOURCE_LOCALE,
        });

        if (stationWasCreated) {
          stats.created++;
        } else {
          stats.updated++;
        }

        targets.push({
          documentId,
          externalId: st.externalId,
          lastReportAt: existingDocument?.status_updated_at ?? null,
        });
      } catch (err) {
        stats.errors++;
        strapi.log.error(
          `chmuSync: upsert failed for ${st.externalId}: ${(err as Error).message}`,
        );
      }
    }

    // Phase B — download latest values, concurrency-limited. `now/` is
    // incomplete (many objects have no now file), so fall back to the recent/
    // monthly file (current month, then previous) which carries equally fresh
    // last points for those objects.
    const [curMonth, prevMonth] = recentMonths();
    const fetched = await mapWithConcurrency(targets, 8, async (t) => {
      try {
        let value = await fetchLatestValue(t.externalId); // now/
        let viaRecent = false;
        if (!value) {
          value = await fetchRecentValue(t.externalId, curMonth);
          if (!value) value = await fetchRecentValue(t.externalId, prevMonth);
          viaRecent = value != null;
        }
        if (viaRecent) stats.recent++;
        return { t, value };
      } catch (err) {
        stats.errors++;
        strapi.log.warn(
          `chmuSync: value fetch failed for ${t.externalId}: ${(err as Error).message}`,
        );
        return { t, value: null };
      }
    });

    // Phase C — append a report only when ČHMÚ is strictly newer, then refresh.
    for (const { t, value } of fetched) {
      if (!value) {
        stats.skipped++;
        continue;
      }
      const isNewer =
        !t.lastReportAt || new Date(value.dt) > new Date(t.lastReportAt);
      if (!isNewer) {
        stats.skipped++;
        continue;
      }

      try {
        const flowScale = await strapi
          .service(CONFIG_UID)
          .flowScaleFromLps(value.valueLps);

        await strapi.documents(REPORT_UID).create({
          // ČHMÚ sensor reports legitimately omit has_odor / water_clarity /
          // device_id (now nullable) and client_report_id (idempotence here is
          // handled by the `dt`-newer check above, not the offline-queue id).
          data: {
            spring: t.documentId,
            source_type: "chmu",
            is_flowing: value.valueLps > 0,
            flow_rate_lps: value.valueLps,
            flow_scale: flowScale,
            reported_at: value.dt,
          },
        });

        await strapi.service(SPRING_UID).refreshLatest(t.documentId);
        stats.reports++;
      } catch (err) {
        stats.errors++;
        strapi.log.error(
          `chmuSync: report failed for ${t.externalId}: ${(err as Error).message}`,
        );
      }
    }

    strapi.log.info(`chmuSync done: ${JSON.stringify(stats)}`);
    return stats;
  },
}));
