#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { compileStrapi, createStrapi } = require("@strapi/strapi");

const appDir = process.cwd();

async function createApp() {
  const distDir = path.join(appDir, "dist");
  const hasCompiledServer =
    fs.existsSync(path.join(distDir, "config")) &&
    fs.existsSync(path.join(distDir, "src"));

  if (hasCompiledServer) {
    return createStrapi({ appDir, distDir });
  }

  const appContext = await compileStrapi({ appDir });
  return createStrapi(appContext);
}

async function main() {
  const app = await createApp();
  await app.load();

  try {
    const locales = app.plugin("i18n").service("locales");
    const [defaultLocale, configuredLocales] = await Promise.all([
      locales.getDefaultLocale(),
      locales.find(),
    ]);

    console.log(`Default locale: ${defaultLocale}`);
    console.log(
      `Configured locales: ${configuredLocales
        .map((locale) => locale.code)
        .join(", ")}`
    );

    const stats = await app.service("api::spring.spring").syncFromChmu();
    console.log(JSON.stringify({ data: stats }, null, 2));

    if (stats.errors > 0) {
      process.exitCode = 1;
    }
  } finally {
    await app.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
