/**
 * Geographic utility functions for distance calculations.
 */

const EARTH_RADIUS_METERS = 6371000;

/**
 * Converts degrees to radians.
 */
function toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
}

/**
 * Calculates the distance between two geographic coordinates using the Haversine formula.
 *
 * The Haversine formula determines the great-circle distance between two points
 * on a sphere given their longitudes and latitudes.
 *
 * @param lat1 - Latitude of the first point in degrees
 * @param lng1 - Longitude of the first point in degrees
 * @param lat2 - Latitude of the second point in degrees
 * @param lng2 - Longitude of the second point in degrees
 * @returns Distance between the two points in meters
 *
 * @example
 * ```typescript
 * const distance = haversineDistance(50.0875, 14.4213, 50.0880, 14.4220);
 * console.log(distance); // ~65 meters
 * ```
 */
export function haversineDistance(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number
): number {
    const dLat = toRadians(lat2 - lat1);
    const dLng = toRadians(lng2 - lng1);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRadians(lat1)) *
        Math.cos(toRadians(lat2)) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return EARTH_RADIUS_METERS * c;
}
