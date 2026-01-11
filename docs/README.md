# Custom Documentation

This folder contains documentation for custom features and extensions implemented in this Strapi application.

## Contents

| Document | Description |
|----------|-------------|
| [Admin Filtering](./admin-filtering.md) | Record-level filtering for Admin Panel based on manager assignments |
| [Lifecycle Hooks](./lifecycle-hooks.md) | Custom lifecycle hooks for Spring and Report content types |

### Admin Filtering Summary

| Content Type | Behavior |
|-------------|----------|
| Spring | Non-Super-Admin users see only Springs where they are in `managers` relation |

### Lifecycle Hooks Summary

| Content Type | Hook | Purpose |
|-------------|------|---------|
| Spring | `afterCreate` | QR code auto-generation with documentId |
| Report | `afterCreate` | Status propagation to parent Spring |

## Adding New Documentation

When adding new custom features, create a dedicated markdown file in this folder and update this index accordingly.

