# Admin Panel Filtering

Spring records are scoped in the Admin Panel through a Document Service
middleware registered in `src/index.ts`.

## Current behavior

The middleware applies only to `api::spring.spring` actions `findMany`,
`findOne`, `update`, and `delete`.

| Caller | Result |
|---|---|
| Super Admin | No manager filter; all Springs are available. |
| Other Admin Panel user | Filtered to Springs whose `managers` relation contains the admin user ID. |
| Content API, API token, or users-permissions caller | Unaffected. |
| Internal service, cron, or bootstrap call | Unaffected. |

The primary gate is the Admin Panel auth strategy:

```ts
ctx.state?.auth?.strategy?.name === "admin"
```

The middleware also requires the Admin user shape with a `roles[]` array. This
prevents a users-permissions identity from being mistaken for an Admin user.

For a scoped request, the manager constraint is combined with existing filters:

```ts
context.params.filters = {
  $and: [
    context.params.filters ?? {},
    { managers: { id: { $eq: user.id } } },
  ],
};
```

This preserves filters supplied by the Content Manager list view.

## Model cardinality

The committed Spring schema defines `managers` as a unidirectional
`oneToMany` relation to `admin::user`. Earlier documentation called it a
many-way relation; that did not match the schema. Any change in cardinality
requires a separate schema and data-migration decision.

## Security boundary

This middleware is an Admin Panel record-visibility boundary. It does not grant
or restrict public content API access; public access is controlled by route auth,
Users & Permissions RBAC, query allowlists, and controller behavior.

Restrict the ability to edit `managers` through Admin Panel role configuration.
Non-super-admin roles should not receive Spring creation permission if Spring
creation is reserved for operators.

## Known verification gap

The pure scoping decision and filter construction are unit-tested. There is no
running-Strapi integration test proving that injected filters constrain
`update` and `delete` for the installed Strapi version. Treat those write paths
as requiring an integration test or an explicit ownership check before relying
on the middleware as the only write authorization control.

Applied scopes emit a debug log:

```text
Spring scope applied for admin user <id> on action <action>
```
