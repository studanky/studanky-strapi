/**
 * Shared flow-scale conversion logic (pure, no Strapi dependency).
 */

export interface FlowRange {
  scale: number;
  min_lps: number;
  max_lps: number;
}

/**
 * Maps a measured flow rate (l/s) to the shared 1–5 flow scale using the given
 * ranges. Returns null when there is no value, no ranges, or the value falls
 * outside every range (caller then leaves `flow_scale` unset).
 */
export function pickFlowScale(
  ranges: FlowRange[] | null | undefined,
  lps: number | null | undefined
): number | null {
  if (lps == null || Number.isNaN(lps)) {
    return null;
  }
  if (!ranges || ranges.length === 0) {
    return null;
  }
  const match = ranges.find((r) => lps >= r.min_lps && lps <= r.max_lps);
  return match ? match.scale : null;
}
