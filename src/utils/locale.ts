/**
 * Shared locale helpers (pure, no Strapi dependency).
 *
 * Flutter's `Locale.toLanguageTag()` uses BCP 47-style hyphenated tags. The
 * underscore replacement below is deliberately only a tolerant compatibility
 * boundary for legacy/non-standard callers (`en_US`); it is not the documented
 * client contract.
 */

export type PreferredLocaleVariants = Record<string, string[]>;
export type ConfiguredLocaleIndex = ReadonlyMap<string, string>;
export type LocaleCanonicalizer = (locale: string) => string | null;

/** Returns a canonical BCP 47 tag, or null for an empty/invalid input. */
export function canonicalizeLocaleTag(value?: string | null): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  try {
    return Intl.getCanonicalLocales(value.trim().replace(/_/g, "-"))[0] ?? null;
  } catch {
    return null;
  }
}

/** Builds the canonical-to-configured spelling index used by all resolvers. */
export function indexConfiguredLocales(
  configured: string[],
  canonicalize: LocaleCanonicalizer = canonicalizeLocaleTag,
): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const locale of configured) {
    const canonical = canonicalize(locale);
    if (!canonical) {
      throw new Error(`Strapi i18n locale ${String(locale)} is invalid`);
    }
    lookup.set(canonical, locale);
  }
  return lookup;
}

/** Matches any accepted spelling against a prevalidated configured index. */
export function findConfiguredLocale(
  locale: string,
  configuredByCanonical: ConfiguredLocaleIndex,
  canonicalize: LocaleCanonicalizer = canonicalizeLocaleTag,
): string | undefined {
  const canonical = canonicalize(locale);
  return canonical ? configuredByCanonical.get(canonical) : undefined;
}

function localeLanguage(value: string): string {
  return new Intl.Locale(value).language;
}

/**
 * Builds an ordered whole-document locale lookup chain.
 *
 * Order:
 *  1. exact requested Flutter language tag,
 *  2. less-specific requested variants (language+script, then language),
 *  3. configured sibling variants of the same language,
 *  4. the application's current default locale.
 *
 * Only configured Strapi locale codes are ever returned. Configured spelling
 * is preserved for Document Service / Query Engine calls. A present document
 * wins as a whole; callers must never continue merely because a field is null.
 * Callers that also resolve document metadata may pass a prebuilt index so the
 * same validated canonical mapping is reused for the entire request.
 */
export function resolveLocaleChain(params: {
  requested?: string | null;
  defaultLocale: string;
  configured: string[] | ConfiguredLocaleIndex;
  preferredVariants?: PreferredLocaleVariants;
}): string[] {
  const { requested, defaultLocale, configured, preferredVariants = {} } =
    params;
  const configuredByCanonical = Array.isArray(configured)
    ? indexConfiguredLocales(configured)
    : configured;

  const chain: string[] = [];
  const addCanonical = (canonical: string | null) => {
    if (!canonical) return;
    const configuredLocale = findConfiguredLocale(
      canonical,
      configuredByCanonical,
    );
    if (configuredLocale) chain.push(configuredLocale);
  };

  const requestedCanonical = canonicalizeLocaleTag(requested);
  if (requestedCanonical) {
    const parsed = new Intl.Locale(requestedCanonical);
    const language = parsed.language;

    // Exact tag first. For a tag with script+region, prefer the script-specific
    // parent before the bare language (e.g. sr-Latn-RS → sr-Latn → sr).
    addCanonical(requestedCanonical);
    if (parsed.script) {
      addCanonical(canonicalizeLocaleTag(`${language}-${parsed.script}`));
    }
    addCanonical(canonicalizeLocaleTag(language));

    // Business preference resolves ambiguous siblings deterministically. Any
    // newly configured sibling omitted from the preference list is still used,
    // in canonical lexical order, so `en-AU` can reach the only `en-US` variant.
    const preferred = preferredVariants[language] ?? [];
    for (const locale of preferred) {
      const canonical = canonicalizeLocaleTag(locale);
      if (canonical && localeLanguage(canonical) === language) {
        addCanonical(canonical);
      }
    }

    const siblings = [...configuredByCanonical.keys()]
      .filter((locale) => localeLanguage(locale) === language)
      .sort((a, b) => a.localeCompare(b));
    for (const sibling of siblings) {
      addCanonical(sibling);
    }
  }

  const configuredDefault = findConfiguredLocale(
    defaultLocale,
    configuredByCanonical,
  );
  if (!configuredDefault) {
    throw new Error(
      `Strapi i18n default locale ${defaultLocale} is not in the configured locale list`,
    );
  }
  chain.push(configuredDefault);

  return [...new Set(chain)];
}
