/**
 * Shared locale helpers (pure, no Strapi dependency).
 */

/**
 * Ordered list of locales to attempt for a Spring **preview** lookup, so a
 * shared web link degrades gracefully instead of 404-ing on language.
 *
 * Rules:
 * - The requested locale is honored **only when it is actually configured**. An
 *   unsupported/garbage locale from a share URL is dropped, never queried — so
 *   the lookup never depends on how the Document Service reacts to an unknown
 *   locale (it is simply never asked one).
 * - The **default locale** is always the final fallback (it is the guaranteed
 *   baseline every spring is published in).
 * - The result is **de-duplicated, order-preserving**, so the caller queries
 *   each locale at most once (requested === default → a single attempt).
 *
 * The remaining reason a later attempt can still be needed even for a valid
 * requested locale: the spring may not yet be **published** in that language,
 * only in the default one.
 */
export function resolvePreviewLocales(params: {
  requested?: string | null;
  defaultLocale: string;
  configured: string[];
}): string[] {
  const { requested, defaultLocale, configured } = params;

  const chain: string[] = [];
  if (requested && configured.includes(requested)) {
    chain.push(requested);
  }
  chain.push(defaultLocale);

  // De-dup while preserving order (requested === default → one entry).
  return [...new Set(chain)];
}
