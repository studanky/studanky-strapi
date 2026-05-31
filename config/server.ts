import cronTasks from "./cron-tasks";

export default ({ env }) => ({
  host: env("HOST", "0.0.0.0"),
  port: env.int("PORT", 1337),
  app: {
    keys: env.array("APP_KEYS"),
  },
  // ČHMÚ sync runs at 00:30 Europe/Prague. Enabled by default; set
  // CRON_ENABLED=false to disable (e.g. local dev where you don't want it).
  cron: {
    enabled: env.bool("CRON_ENABLED", true),
    tasks: cronTasks,
  },
});
