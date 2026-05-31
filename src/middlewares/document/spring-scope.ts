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

/** Minimal request-context shape the scope decision depends on. */
export interface ScopeRequestContext {
  state?: {
    auth?: { strategy?: { name?: string } };
    // Admin users carry a `roles[]` array; users-permissions users only have a
    // single `role`. We use the array shape as an independent sanity check.
    user?: { id: number; roles?: { code: string }[] };
  };
}

export interface ScopeDecision {
  /** Whether the manager filter should be applied. */
  apply: boolean;
  /** The admin user id to scope to (only when `apply`). */
  userId?: number;
}

/**
 * Pure decision: should this Document Service call be scoped, and to whom?
 * Extracted so the gate logic is unit-testable without Strapi.
 */
export function resolveSpringScope(params: {
  uid: string;
  action: string;
  ctx: ScopeRequestContext | null | undefined;
}): ScopeDecision {
  const { uid, action, ctx } = params;

  // Only Spring + relevant actions.
  if (uid !== SCOPED_UID || !SCOPED_ACTIONS.includes(action)) {
    return { apply: false };
  }
  // No request context → internal call (cron, bootstrap, services) → no filter.
  if (!ctx) {
    return { apply: false };
  }
  // ROBUST GATE: only the Admin Panel auth strategy.
  if (ctx.state?.auth?.strategy?.name !== "admin") {
    return { apply: false };
  }
  // Sanity check: admin user shape (UP user has no `roles[]`).
  const user = ctx.state.user;
  if (!user || !Array.isArray(user.roles)) {
    return { apply: false };
  }
  // Super Admin sees everything.
  if (user.roles.some((role) => role.code === SUPER_ADMIN_ROLE_CODE)) {
    return { apply: false };
  }
  return { apply: true, userId: user.id };
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
    const decision = resolveSpringScope({
      uid: context.uid,
      action: context.action,
      ctx: strapi.requestContext.get() as ScopeRequestContext | undefined,
    });

    if (!decision.apply) {
      return next();
    }

    // Merge with existing filters via $and so admin's own search/sort in the
    // list view is preserved (not overwritten).
    const params = (context.params ?? {}) as {
      filters?: Record<string, unknown>;
    };
    params.filters = {
      $and: [
        params.filters ?? {},
        { managers: { id: { $eq: decision.userId } } },
      ],
    };
    context.params = params as typeof context.params;

    strapi.log.debug(
      `Spring scope applied for admin user ${decision.userId} on action ${context.action}`
    );

    return next();
  };
