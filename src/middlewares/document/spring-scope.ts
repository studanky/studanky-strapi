import type { Core } from "@strapi/strapi";

/**
 * Spring Record-Level Scoping — Document Service middleware.
 *
 * Restricts which Spring entries an Admin Panel user can see/modify based on
 * the `managers` relation. Behavior:
 * - Super Admins: see all Springs (no filter).
 * - Other admin users: only Springs where they are in `managers`.
 *
 * IMPORTANT — this is an ADMIN PANEL access boundary only. The gate keys on the
 * admin auth strategy (`ctx.state.auth.strategy.name === 'admin'`), NOT on the
 * mere presence of `ctx.state.user`. Otherwise a logged-in users-permissions
 * user hitting the public `/api/springs/map` would get the `managers` filter
 * and see nothing. Public content API access is governed by RBAC + custom
 * controllers/policies, not this middleware.
 */

const SCOPED_UID = "api::spring.spring";
const SCOPED_ACTIONS: string[] = ["findMany", "findOne", "update", "delete"];
const SUPER_ADMIN_ROLE_CODE = "strapi-super-admin";

interface AdminUser {
  id: number;
  // Admin users carry a `roles[]` array; users-permissions users only have a
  // single `role`. We use the array shape as an independent sanity check.
  roles?: { code: string }[];
}

/** Document Service middleware signature, inferred from the official API. */
type DocumentMiddleware = Parameters<Core.Strapi["documents"]["use"]>[0];

/**
 * Builds the Document Service middleware, capturing `strapi` via closure so it
 * can read the request context and log. Registered in `register()` via
 * `strapi.documents.use(createSpringScope(strapi))`.
 */
export const createSpringScope =
  (strapi: Core.Strapi): DocumentMiddleware =>
  async (context, next) => {
    // 1) Only Spring + relevant actions.
    if (
      context.uid !== SCOPED_UID ||
      !SCOPED_ACTIONS.includes(context.action)
    ) {
      return next();
    }

    const ctx = strapi.requestContext.get();

    // 2) No request context → internal call (cron, bootstrap, services) → no filter.
    if (!ctx) {
      return next();
    }

    // 3) ROBUST GATE: filter only for the Admin Panel auth strategy.
    //    Excludes users-permissions, api-token and public unauth requests.
    if (ctx.state?.auth?.strategy?.name !== "admin") {
      return next();
    }

    // 4) Sanity check: verify admin user shape (UP user has no `roles[]`).
    const user = ctx.state.user as AdminUser | undefined;
    if (!user || !Array.isArray(user.roles)) {
      return next();
    }

    // 5) Super Admin sees everything.
    if (user.roles.some((role) => role.code === SUPER_ADMIN_ROLE_CODE)) {
      return next();
    }

    // 6) Merge with existing filters via $and so admin's own search/sort in the
    //    list view is preserved (not overwritten).
    const params = (context.params ?? {}) as {
      filters?: Record<string, unknown>;
    };
    params.filters = {
      $and: [params.filters ?? {}, { managers: { id: { $eq: user.id } } }],
    };
    context.params = params as typeof context.params;

    strapi.log.debug(
      `Spring scope applied for admin user ${user.id} on action ${context.action}`
    );

    return next();
  };
