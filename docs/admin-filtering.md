# Admin Panel Filtering

This document describes record-level filtering implemented for the Admin Panel.

## Spring Collection - Manager-Based Filtering

**Location:** `src/index.ts`

Restricts Spring entries visible in the Admin Panel based on the `managers` relation.

### Behavior

| User | Springs Visible |
|------|-----------------|
| Super Admin | All |
| Any other admin | Only where user is in `managers` relation |

### Implementation

Uses a Document Service middleware registered in `register()` lifecycle:

```typescript
strapi.documents.use(async (context, next) => {
  // Filter logic for api::spring.spring
});
```

### Actions Affected

- `findMany` — List view
- `findOne` — Single record access
- `update` — Edit access
- `delete` — Delete access

### How It Works

1. Middleware intercepts Document Service calls for `api::spring.spring`
2. Gets current admin user via `strapi.requestContext.get()`
3. Checks if user has `strapi-super-admin` role → skip filtering
4. Otherwise injects filter: `managers.id = currentUserId`

### Logs

```
[debug] Spring filter applied for admin user <id> on action <action>
```

### Technical Notes

- Filter uses Strapi's deep filtering: `managers: { id: { $eq: userId } }`
- Super Admin detection uses `role.code === "strapi-super-admin"`
- Unauthenticated requests (no user in context) are not filtered
