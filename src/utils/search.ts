/**
 * Normalizes user-facing names for accent-insensitive search.
 *
 * Czech users often type place names without diacritics. Keep this helper pure
 * and shared by writes + reads so the stored search value and query value match.
 */
export function normalizeSearchText(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
