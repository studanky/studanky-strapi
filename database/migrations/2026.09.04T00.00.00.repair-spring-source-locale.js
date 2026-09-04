"use strict";

/**
 * Re-applies the idempotent source-locale backfill for databases whose Spring
 * rows were imported or rewritten after the original migration had completed.
 * Keeping a new migration identity ensures existing deployments run the repair
 * exactly once without duplicating the inference rules.
 */
const sourceLocaleMigration = require("./2026.08.24T00.00.00.spring-source-locale.js");

module.exports = {
  async up(knex) {
    await sourceLocaleMigration.up(knex);
  },
};
