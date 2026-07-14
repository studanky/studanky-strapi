#!/usr/bin/env node

"use strict";

/**
 * Deletes orphaned Spring QR-code assets from the Media Library.
 *
 * Background: before the `afterCreate` fix, every `documents().publish()` (and
 * every nightly ČHMÚ sync re-publish) regenerated a Spring's QR code and left
 * the previous file orphaned — linked to a now-deleted published row. Those
 * files accumulate in the Media Library (and on S3/R2 when AWS_BUCKET is set).
 *
 * An orphan here = a `files` row named `spring-qr-%` that has NO row in the
 * `files_related_mph` morph table (i.e. it is not linked to any Spring's
 * `qr_code`). Live QR codes (linked to a draft or published Spring) are never
 * touched, so this is safe to run repeatedly.
 *
 * Deletion goes through the upload service's `remove()` so the physical object
 * (S3/R2/local) is deleted too — not just the DB row.
 *
 * Usage:
 *   node scripts/ops/cleanup-qr-orphans.js            # dry-run: report only
 *   node scripts/ops/cleanup-qr-orphans.js --apply    # actually delete
 *   npm run cleanup:qr-orphans -- --apply
 *
 * IMPORTANT: deploy the lifecycle fix first, otherwise the next nightly sync
 * recreates fresh orphans.
 */

const fs = require("node:fs");
const path = require("node:path");
const { compileStrapi, createStrapi } = require("@strapi/strapi");

const appDir = process.cwd();
const FILE_UID = "plugin::upload.file";
const MORPH_TABLE = "files_related_mph";
const NAME_PREFIX = "spring-qr-";
const SAMPLE_COUNT = 10;

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
  const apply = process.argv.includes("--apply");

  const app = await createApp();
  await app.load();

  const summary = { qr_files: 0, linked: 0, orphans: 0, deleted: 0, failed: 0 };

  try {
    // All QR files, then the set of file ids that ARE linked via the morph table.
    const [qrFiles, linkedRows] = await Promise.all([
      app.db.query(FILE_UID).findMany({
        where: { name: { $startsWith: NAME_PREFIX } },
      }),
      app.db.connection(MORPH_TABLE).distinct("file_id"),
    ]);

    const linkedIds = new Set(linkedRows.map((row) => row.file_id));
    const orphans = qrFiles.filter((file) => !linkedIds.has(file.id));

    summary.qr_files = qrFiles.length;
    summary.orphans = orphans.length;
    summary.linked = qrFiles.length - orphans.length;

    console.log(
      `QR files: ${summary.qr_files} | linked (kept): ${summary.linked} | orphans: ${summary.orphans}`
    );

    if (orphans.length > 0) {
      const samples = orphans
        .slice(0, SAMPLE_COUNT)
        .map((f) => `  #${f.id} ${f.name}`);
      console.log(
        `Sample orphans (first ${Math.min(SAMPLE_COUNT, orphans.length)}):\n${samples.join("\n")}`
      );
    }

    if (!apply) {
      console.log(
        `\nDry-run — nothing deleted. Re-run with --apply to delete ${orphans.length} orphan(s).`
      );
      return;
    }

    if (orphans.length === 0) {
      console.log("\nNothing to delete.");
      return;
    }

    console.log(`\nDeleting ${orphans.length} orphan(s) via upload service...`);
    const uploadService = app.plugin("upload").service("upload");

    // Sequential: each remove() is a provider (S3/R2) call; keep it gentle and
    // observable rather than hammering the object store concurrently.
    for (let i = 0; i < orphans.length; i++) {
      const file = orphans[i];
      try {
        await uploadService.remove(file);
        summary.deleted++;
      } catch (err) {
        summary.failed++;
        console.error(
          `  failed to delete #${file.id} ${file.name}: ${err.message}`
        );
      }

      if ((i + 1) % 100 === 0 || i + 1 === orphans.length) {
        console.log(`  ${i + 1}/${orphans.length} processed`);
      }
    }
  } finally {
    console.log(`\n${JSON.stringify({ data: summary }, null, 2)}`);
    await app.destroy();
  }

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
