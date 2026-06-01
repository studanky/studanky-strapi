export default ({ env }) => {
  // SMTP is "prepared" but optional: auth is only attached when credentials
  // exist or SMTP_AUTH_ENABLED=true (supports IP-authenticated relays too).
  const smtpAuthEnabled = env.bool(
    "SMTP_AUTH_ENABLED",
    Boolean(env("SMTP_USER") && env("SMTP_PASS"))
  );

  // Object/media storage. When AWS_BUCKET is set, uploads go to S3/R2 instead
  // of the local volume (recommended once owners start uploading photos).
  // Works for native AWS S3 and S3-compatible stores (Cloudflare R2, MinIO)
  // via AWS_ENDPOINT + AWS_FORCE_PATH_STYLE.
  const useS3 = Boolean(env("AWS_BUCKET"));

  return {
    email: {
      config: {
        provider: "nodemailer",
        providerOptions: {
          host: env("SMTP_HOST", "localhost"),
          port: env.int("SMTP_PORT", 587),
          secure: env.bool("SMTP_SECURE", false),
          requireTLS: env.bool("SMTP_REQUIRE_TLS", false),
          ...(smtpAuthEnabled
            ? {
                auth: {
                  user: env("SMTP_USER"),
                  pass: env("SMTP_PASS"),
                },
              }
            : {}),
          tls: {
            rejectUnauthorized: env.bool("SMTP_TLS_REJECT_UNAUTHORIZED", true),
          },
        },
        settings: {
          defaultFrom: env("DEFAULT_FROM_EMAIL"),
          defaultReplyTo: env("DEFAULT_REPLY_TO_EMAIL"),
        },
      },
    },

    ...(useS3
      ? {
          upload: {
            config: {
              provider: "aws-s3",
              providerOptions: {
                // Optional public base URL (CDN / R2 public bucket URL). When
                // unset the provider derives the URL from the S3 endpoint.
                baseUrl: env("UPLOAD_CDN_URL"),
                rootPath: env("AWS_ROOT_PATH"),
                s3Options: {
                  credentials: {
                    accessKeyId: env("AWS_ACCESS_KEY_ID"),
                    secretAccessKey: env("AWS_ACCESS_SECRET"),
                  },
                  // endpoint + forcePathStyle are for R2/MinIO; omit for AWS.
                  endpoint: env("AWS_ENDPOINT"),
                  region: env("AWS_REGION"),
                  forcePathStyle: env.bool("AWS_FORCE_PATH_STYLE", false),
                  params: {
                    Bucket: env("AWS_BUCKET"),
                  },
                },
              },
              actionOptions: {
                upload: {},
                uploadStream: {},
                delete: {},
              },
            },
          },
        }
      : {}),
  };
};
