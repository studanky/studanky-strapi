# Custom Documentation

This folder contains documentation for custom features and extensions implemented in this Strapi application.

## Contents

| Document | Description |
|----------|-------------|
| [Lifecycle Hooks](./lifecycle-hooks.md) | Custom lifecycle hooks for Spring and Report content types |

### Lifecycle Hooks Summary

| Content Type | Hook | Purpose |
|-------------|------|---------|
| Spring | `afterCreate` | QR code auto-generation with documentId |
| Report | `afterCreate` | Status propagation to parent Spring |

## Adding New Documentation

When adding new custom features, create a dedicated markdown file in this folder and update this index accordingly.
