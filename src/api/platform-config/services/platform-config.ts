/**
 * platform-config service
 */

import { factories } from "@strapi/strapi";

const CONFIG_UID = "api::platform-config.platform-config";

interface FlowRange {
  scale: number;
  min_lps: number;
  max_lps: number;
}

export default factories.createCoreService(CONFIG_UID, ({ strapi }) => ({
  /**
   * Maps a measured flow rate (l/s) to the shared 1–5 flow scale using the
   * ranges configured in Platform Config.
   *
   * Returns null when there is no config, no ranges configured, or the value
   * falls outside every configured range — callers then leave `flow_scale`
   * unset (the `is_flowing` signal still works without a numeric scale).
   */
  async flowScaleFromLps(
    lps: number | null | undefined
  ): Promise<number | null> {
    if (lps == null || Number.isNaN(lps)) {
      return null;
    }

    const config = (await strapi.documents(CONFIG_UID).findFirst({
      populate: { flow_scale_ranges: true },
    })) as { flow_scale_ranges?: FlowRange[] } | null;

    const ranges = config?.flow_scale_ranges ?? [];
    if (!ranges.length) {
      return null;
    }

    const match = ranges.find((r) => lps >= r.min_lps && lps <= r.max_lps);
    return match ? match.scale : null;
  },
}));
