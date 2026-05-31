/**
 * ČHMÚ Open Data adapter (groundwater / springs).
 *
 * Pure source adapter: fetches + parses the static ČHMÚ JSON files and returns
 * neutral DTOs. It holds NO knowledge of the Strapi data model — mapping ČHMÚ
 * → canonical model happens in the spring service (`syncFromChmu`). This keeps
 * ČHMÚ specifics out of the core; future sources are just additional adapters.
 *
 * Parsing is split into pure functions (`parseStations`, `parseLatestValue`) so
 * it is unit-testable without network access.
 *
 * Source docs: docs/chmu_groundwater_api_documentation.md (branch `now/`).
 */

const BASE = "https://opendata.chmi.cz/hydrology/groundwater/now";
const META1_URL = `${BASE}/metadata/meta1.json`;
const dataUrl = (objID: string) => `${BASE}/data/${objID}_D.json`;

/** Spring station from meta1.json (OBJECT_TYPE === 'spring'). */
export interface ChmuStation {
  externalId: string; // objID, e.g. "0-203-1-PB0013"
  name: string;
  lat: number; // GEOGR1
  lng: number; // GEOGR2
  altitude: number | null;
}

/** Latest discharge reading (YD / L_S series). */
export interface ChmuValue {
  dt: string; // ISO UTC
  valueLps: number; // discharge in l/s
}

/**
 * Fetches JSON with timeout + retry. Returns null on 404 (file may not exist
 * for a given object), throws on other persistent failures.
 */
async function fetchJson(
  url: string,
  timeoutMs = 15000,
  retries = 2
): Promise<unknown | null> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

/**
 * Parses a ČHMÚ `DataCollection` positionally. Rows are arrays whose order
 * matches the comma-separated `header`; never rely on named fields in a row.
 * Accepts the `data` node (the `{ type, data: { header, values } }` wrapper).
 */
export function parseDataCollection(dc: unknown): {
  columns: string[];
  rows: unknown[][];
} {
  const data = (dc as { data?: { header?: string; values?: unknown[][] } })
    ?.data;
  const columns = (data?.header ?? "").split(",").map((c) => c.trim());
  const rows = Array.isArray(data?.values) ? data!.values : [];
  return { columns, rows };
}

/** Maps a parsed meta1.json document → spring stations. Pure. */
export function parseStations(meta1Json: unknown): ChmuStation[] {
  const root = meta1Json as { data?: unknown } | null;
  if (!root) return [];

  const { columns, rows } = parseDataCollection(root.data);
  const col = (name: string) => columns.indexOf(name);
  const iId = col("objID");
  const iName = col("OBJECT_NAME");
  const iType = col("OBJECT_TYPE");
  const iLat = col("GEOGR1");
  const iLng = col("GEOGR2");
  const iAlt = col("ALTITUDE");

  const stations: ChmuStation[] = [];
  for (const row of rows) {
    if (row[iType] !== "spring") continue;

    const externalId = String(row[iId] ?? "");
    const lat = Number(row[iLat]);
    const lng = Number(row[iLng]);
    if (!externalId || Number.isNaN(lat) || Number.isNaN(lng)) continue;

    const altRaw = iAlt >= 0 ? row[iAlt] : null;
    stations.push({
      externalId,
      name: String(row[iName] ?? externalId),
      lat,
      lng,
      altitude: altRaw != null ? Number(altRaw) : null,
    });
  }
  return stations;
}

/**
 * Maps a parsed `{objID}_D.json` document → latest YD/L_S value. Pure.
 * Selects the series by name (not array order); returns the newest tsData point
 * or null on empty/missing series.
 */
export function parseLatestValue(dataJson: unknown): ChmuValue | null {
  const json = dataJson as {
    objList?: Array<{
      tsList?: Array<{
        tsConID?: string;
        unit?: string;
        tsData?: Array<{ dt?: string; value?: number }>;
      }>;
    }>;
  } | null;
  if (!json) return null;

  const obj = json.objList?.[0];
  const series = obj?.tsList?.find(
    (ts) => ts.tsConID === "YD" && ts.unit === "L_S"
  );
  const points = series?.tsData;
  if (!Array.isArray(points) || points.length === 0) return null;

  let latest: { dt?: string; value?: number } | null = null;
  for (const p of points) {
    if (p?.dt == null || p?.value == null) continue;
    if (!latest || new Date(p.dt) > new Date(latest.dt as string)) {
      latest = p;
    }
  }
  if (!latest) return null;

  return { dt: latest.dt as string, valueLps: Number(latest.value) };
}

/** Loads spring stations from `now/metadata/meta1.json`. */
export async function listSpringStations(): Promise<ChmuStation[]> {
  return parseStations(await fetchJson(META1_URL));
}

/** Latest discharge value for a station from `now/data/{objID}_D.json`. */
export async function fetchLatestValue(
  externalId: string
): Promise<ChmuValue | null> {
  return parseLatestValue(await fetchJson(dataUrl(externalId)));
}
