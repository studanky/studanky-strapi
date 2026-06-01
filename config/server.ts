import cronTasks from "./cron-tasks";

export default ({ env }) => {
  // Public URL for absolute links (QR deeplinks, email links, admin redirects).
  // Prefer explicit PUBLIC_URL; otherwise derive https://DOMAIN when set.
  const domain = env("DOMAIN");
  const publicUrl = env("PUBLIC_URL", domain ? `https://${domain}` : "");

  return {
    host: env("HOST", "0.0.0.0"),
    port: env.int("PORT", 1337),
    app: {
      keys: env.array("APP_KEYS"),
    },
    // Behind Traefik (TLS termination) this MUST be true, otherwise Strapi
    // builds absolute URLs from the internal http://strapi:1337 and breaks
    // QR deeplinks, email links and redirects. Override with IS_PROXIED=false
    // for direct local access without a reverse proxy.
    proxy: env.bool("IS_PROXIED", true),
    ...(publicUrl ? { url: publicUrl } : {}),
    // ČHMÚ sync runs at 03:30 Europe/Prague. Enabled by default; set
    // CRON_ENABLED=false to disable (e.g. local dev where you don't want it).
    cron: {
      enabled: env.bool("CRON_ENABLED", true),
      tasks: cronTasks,
    },
  };
};
