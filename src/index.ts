import type { Core } from "@strapi/strapi";
import { createSpringScope } from "./middlewares/document/spring-scope";
import { ensureDbIndexes } from "./utils/ensure-db-indexes";
import {
  ensureSpringSearchIndexes,
  ensureSpringSearchNames,
} from "./utils/ensure-spring-search";

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register({ strapi }: { strapi: Core.Strapi }) {
    // Admin-panel record-level scoping for Spring by `managers` relation.
    strapi.documents.use(createSpringScope(strapi));
  },

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    await ensureDbIndexes(strapi);
    await ensureSpringSearchNames(strapi);
    await ensureSpringSearchIndexes(strapi);
  },
};
