/**
 * Shared geo helpers (pure, no Strapi dependency).
 */

const EARTH_RADIUS_M = 6_371_000; // mean Earth radius in metres

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/**
 * Great-circle distance between two lat/lng points in **metres** (haversine).
 *
 * Accurate enough for ranking nearby springs and the 200 m geofence (spec
 * §8.1). Returns `NaN` if any coordinate is not a finite number, so callers can
 * filter unsortable rows.
 */
export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  if (![lat1, lng1, lat2, lng2].every((n) => Number.isFinite(n))) {
    return Number.NaN;
  }

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** True when both values are finite numbers usable as a coordinate origin. */
export function isValidOrigin(
  lat: number | undefined,
  lng: number | undefined
): boolean {
  return (
    Number.isFinite(lat as number) &&
    Number.isFinite(lng as number) &&
    Math.abs(lat as number) <= 90 &&
    Math.abs(lng as number) <= 180
  );
}
