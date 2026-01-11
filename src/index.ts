import type { Core } from "@strapi/strapi";

/**
 * Spring Record-Level Filtering Middleware
 *
 * This middleware restricts access to Spring entries in the Admin Panel
 * based on the authenticated admin user's manager assignments.
 *
 * Behavior:
 * - Super Admins: See all Springs (no filtering)
 * - All other admin users: Only see Springs where they are listed in the `managers` relation
 *
 * Actions affected: findMany, findOne, update, delete
 */

const SPRING_UID = "api::spring.spring";
const SUPER_ADMIN_ROLE_CODE = "strapi-super-admin";

interface AdminRole {
  id: number;
  name: string;
  code: string;
}

interface AdminUser {
  id: number;
  roles: AdminRole[];
}

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register({ strapi }: { strapi: Core.Strapi }) {
    // Register Document Service middleware for Spring filtering by manager relation
    strapi.documents.use(async (context, next) => {
      // Only apply to api::spring.spring
      if (context.uid !== SPRING_UID) {
        return next();
      }

      // Only apply to read/modify actions
      const restrictedActions = ["findMany", "findOne", "update", "delete"];
      if (!restrictedActions.includes(context.action)) {
        return next();
      }

      // Get HTTP request context to access the authenticated admin user
      const ctx = strapi.requestContext.get();
      const user = ctx?.state?.user as AdminUser | undefined;

      // No user = not from authenticated Admin UI request (skip filtering)
      if (!user) {
        return next();
      }

      // Super Admins see everything
      const isSuperAdmin = user.roles?.some(
        (role) => role.code === SUPER_ADMIN_ROLE_CODE
      );

      if (isSuperAdmin) {
        return next();
      }

      // All other admin users: only see Springs where they are in `managers` relation
      // This uses Strapi's deep filtering on relations
      // Type assertion is safe because we've already verified the action supports filters
      const params = context.params as { filters?: Record<string, unknown> };
      params.filters = {
        ...params.filters,
        managers: {
          id: {
            $eq: user.id,
          },
        },
      };

      strapi.log.debug(
        `Spring filter applied for admin user ${user.id} on action ${context.action}`
      );

      return next();
    });
  },

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  bootstrap(/* { strapi }: { strapi: Core.Strapi } */) { },
};
