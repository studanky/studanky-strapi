# Admin Panel Filtering

Record-level scoping for the Admin Panel: admin users see only the Springs they
manage. This is an **admin-panel access boundary only** — public content API
access is governed by RBAC + the custom controllers/policies.

## Spring scoping — manager-based

**Location:** `src/middlewares/document/spring-scope.ts`
(registered in `src/index.ts` via `strapi.documents.use(createSpringScope(strapi))`).

| User | Springs visible |
|------|-----------------|
| Super Admin (`strapi-super-admin`) | All |
| Any other admin | Only where they are in the `managers` relation |
| Everyone else (public, users-permissions, API token, internal) | Unaffected |

Actions affected: `findMany`, `findOne`, `update`, `delete`.

## How it works

A Document Service middleware scoped to `api::spring.spring`:

1. Skips anything that isn't a scoped Spring action.
2. **No request context** (cron, bootstrap, internal service calls) → no filter.
3. **Admin gate:** applies the filter **only when the request used the admin auth
   strategy** — `ctx.state.auth.strategy.name === 'admin'`. A second sanity check
   verifies the admin user shape (`Array.isArray(user.roles)`; users-permissions
   users have a single `role`, not `roles[]`).
4. Super Admin → no filter.
5. Otherwise merges `managers: { id: { $eq: user.id } }` into existing filters via
   **`$and`**, so the admin's own search/sort in the list view is preserved.

```ts
context.params.filters = {
  $and: [context.params.filters ?? {}, { managers: { id: { $eq: user.id } } }],
};
```

## Why gate on the auth strategy, not `ctx.state.user`

If the filter keyed on the mere presence of `ctx.state.user`, a logged-in
**users-permissions** user hitting the public `/api/springs/map` would get the
`managers` filter applied (with their non-admin id) and see **nothing**. Gating on
the admin strategy keeps the public API correct while still scoping the panel.

## Notes

- The `managers` relation is `manyWay → admin::user` (a manager can own many
  springs; a spring can have many managers).
- `update` / `delete` operate by `documentId`; if you find the injected filter
  does not constrain a write in your Strapi version, add an explicit ownership
  check before the write.
- Restrict who may edit the `managers` field itself (super-admin only) via admin
  RBAC so owners cannot grant themselves access.

## Logs

```
[debug] Spring scope applied for admin user <id> on action <action>
```
