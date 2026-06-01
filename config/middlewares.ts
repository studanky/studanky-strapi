export default ({ env }) => {
  // Comma-separated allowed origins for the public/content API in production
  // (e.g. the Flutter app domains, admin host). Defaults to "*" for local dev.
  const corsOrigins = env("CORS_ORIGINS", "*");
  // Public host serving uploaded media when using S3/R2/CDN, so the admin
  // panel can render image/media previews (CSP img-src/media-src).
  const uploadCdnHost = env("UPLOAD_CDN_HOST");

  return [
    "strapi::logger",
    "strapi::errors",
    {
      name: "strapi::security",
      config: {
        contentSecurityPolicy: {
          useDefaults: true,
          directives: {
            "connect-src": ["'self'", "https:"],
            "img-src": [
              "'self'",
              "data:",
              "blob:",
              ...(uploadCdnHost ? [uploadCdnHost] : []),
            ],
            "media-src": [
              "'self'",
              "data:",
              "blob:",
              ...(uploadCdnHost ? [uploadCdnHost] : []),
            ],
            upgradeInsecureRequests: null,
          },
        },
      },
    },
    {
      name: "strapi::cors",
      config: {
        origin:
          corsOrigins === "*"
            ? "*"
            : corsOrigins.split(",").map((o) => o.trim()),
      },
    },
    "strapi::poweredBy",
    "strapi::query",
    "strapi::body",
    "strapi::session",
    "strapi::favicon",
    "strapi::public",
  ];
};
