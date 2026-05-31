/**
 * Scheduled tasks. The cron only TRIGGERS the service — no logic lives here.
 */

export default {
  chmuSync: {
    task: async ({ strapi }: { strapi: import("@strapi/strapi").Core.Strapi }) => {
      await strapi.service("api::spring.spring").syncFromChmu();
    },
    options: {
      rule: "30 3 * * *", // 03:30 local time
      tz: "Europe/Prague",
    },
  },
};
