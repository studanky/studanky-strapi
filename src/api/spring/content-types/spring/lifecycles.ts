import QRCode from "qrcode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { errors } from "@strapi/utils";
import { normalizeSearchText } from "../../../../utils/search";
import {
  canonicalizeLocaleTag,
  indexConfiguredLocales,
  type ConfiguredLocaleIndex,
} from "../../../../utils/locale";

const SPRING_UID = "api::spring.spring";
const CHMU_SOURCE_LOCALE = "cs";

const syncNameSearch = (data: Record<string, unknown>) => {
  if (typeof data.name === "string") {
    data.name_search = normalizeSearchText(data.name);
  }
};

const getConfiguredLocaleIndex = async (): Promise<ConfiguredLocaleIndex> => {
  const locales = (await strapi
    .plugin("i18n")
    .service("locales")
    .find()) as Array<{ code?: unknown }>;
  const codes = locales
    .map(({ code }) => (typeof code === "string" ? code : ""))
    .filter(Boolean);
  if (codes.length === 0) {
    throw new Error("Strapi i18n has no configured locales");
  }
  return indexConfiguredLocales(codes);
};

const canonicalConfiguredLocale = (
  value: unknown,
  configuredByCanonical: ConfiguredLocaleIndex,
  field = "source_locale",
): string => {
  const canonical = canonicalizeLocaleTag(
    typeof value === "string" ? value : undefined,
  );
  if (!canonical) {
    throw new errors.ValidationError(
      `Spring ${field} must be a valid locale code`,
    );
  }
  if (!configuredByCanonical.has(canonical)) {
    throw new errors.ValidationError(
      `Spring ${field} must be configured in Strapi i18n`,
    );
  }
  return canonical;
};

/**
 * Source locale belongs to the whole document and is assigned exactly once.
 * Publication clones/localizations keep the already persisted value; a new
 * ČHMÚ document is always Czech, and any other new document uses the locale in
 * which it was first created (or the then-current Strapi default).
 */
const ensureSourceLocaleOnCreate = async (data: Record<string, unknown>) => {
  const configuredByCanonical = await getConfiguredLocaleIndex();

  const documentId =
    typeof data.documentId === "string" ? data.documentId : undefined;
  if (documentId) {
    const existingRows = (await strapi.db.query(SPRING_UID).findMany({
      where: { documentId },
      select: ["source_locale"],
      orderBy: { id: "asc" },
    })) as Array<{ source_locale?: string | null }>;
    if (existingRows.length > 0) {
      const sources = existingRows.map((row) =>
        canonicalConfiguredLocale(row.source_locale, configuredByCanonical),
      );
      const distinctSources = [...new Set(sources)];
      if (distinctSources.length !== 1) {
        throw new errors.ValidationError(
          "Spring has conflicting source_locale values across its physical rows",
        );
      }

      const persisted = distinctSources[0];
      if (typeof data.source_locale === "string" && data.source_locale.trim()) {
        const requested = canonicalConfiguredLocale(
          data.source_locale,
          configuredByCanonical,
        );
        if (requested !== persisted) {
          throw new errors.ValidationError(
            "Spring source_locale is immutable across document localizations",
          );
        }
      }
      data.source_locale = persisted;
      return;
    }
  }

  const creationLocale =
    typeof data.locale === "string"
      ? data.locale
      : await strapi.plugin("i18n").service("locales").getDefaultLocale();
  if (!creationLocale) {
    throw new Error("Strapi i18n default locale is not configured");
  }
  const canonicalCreationLocale = canonicalConfiguredLocale(
    creationLocale,
    configuredByCanonical,
    "creation locale",
  );
  const requestedSource =
    typeof data.source_locale === "string" && data.source_locale.trim()
      ? canonicalConfiguredLocale(data.source_locale, configuredByCanonical)
      : canonicalCreationLocale;

  if (requestedSource !== canonicalCreationLocale) {
    throw new errors.ValidationError(
      "A new Spring source_locale must equal its creation locale",
    );
  }
  if (
    data.external_source === "chmu" &&
    canonicalCreationLocale !== CHMU_SOURCE_LOCALE
  ) {
    throw new errors.ValidationError(
      `ČHMÚ Springs must be created in locale ${CHMU_SOURCE_LOCALE}`,
    );
  }
  data.source_locale = requestedSource;
};

const preventSourceLocaleChange = async (event: {
  params: {
    data: Record<string, unknown>;
    where?: Record<string, unknown>;
  };
}) => {
  const { data, where } = event.params;
  if (!Object.prototype.hasOwnProperty.call(data, "source_locale")) {
    return;
  }

  const configuredByCanonical = await getConfiguredLocaleIndex();

  const existing = where
    ? ((await strapi.db.query(SPRING_UID).findOne({
        where,
        select: ["source_locale"],
      })) as { source_locale?: string | null } | null)
    : null;

  if (!existing?.source_locale) {
    throw new errors.ValidationError(
      "Spring has no persisted source_locale; repair the document before updating it",
    );
  }

  const persisted = canonicalConfiguredLocale(
    existing.source_locale,
    configuredByCanonical,
  );
  const requested = canonicalConfiguredLocale(
    data.source_locale,
    configuredByCanonical,
  );
  if (persisted !== requested) {
    throw new errors.ValidationError(
      "Spring source_locale is immutable after creation",
    );
  }
  data.source_locale = persisted;
};

/**
 * Decides whether the `afterCreate` hook should generate a QR code for the row
 * that just got created. Pure + unit-tested (see tests/unit/spring-qr.test.ts).
 *
 * A Spring needs exactly ONE QR for its lifetime — the content is the immutable
 * `documentId`, so it never needs regenerating. But Strapi v5 fires `afterCreate`
 * for EVERY row creation, not just a genuine new document:
 *   - `documents().publish()` clones the draft into a fresh published row
 *     (publish → entries.publish → createEntry → db.query().create), and re-runs
 *     on every nightly ČHMÚ sync. These clones carry `publishedAt`.
 *   - `discardDraft` re-creates the draft row.
 * Publish also deep-populates and clones the draft's `qr_code` relation onto the
 * published row, so generating only on the genuine draft creation is enough — the
 * published row inherits the same file automatically.
 */
export function shouldGenerateQr(args: {
  publishedAt: unknown; // event.params.data.publishedAt
  hasExistingQr: boolean; // the document already has a linked qr_code
}): boolean {
  if (args.publishedAt) return false; // published-row clone (publish / re-publish)
  if (args.hasExistingQr) return false; // idempotent (discardDraft, re-create)
  return true; // genuine draft creation without a QR yet
}

/**
 * Lifecycle hooks for the Spring content type.
 *
 * Automatically generates a QR code containing the documentId when a new
 * Spring entry is created. The QR code is uploaded to the Media Library
 * and linked to the Spring's qr_code field.
 */
export default {
  async beforeCreate(event: { params: { data: Record<string, unknown> } }) {
    syncNameSearch(event.params.data);
    await ensureSourceLocaleOnCreate(event.params.data);
  },

  async beforeUpdate(event: {
    params: {
      data: Record<string, unknown>;
      where?: Record<string, unknown>;
    };
  }) {
    syncNameSearch(event.params.data);
    await preventSourceLocaleChange(event);
  },

  async afterCreate(event: {
    result: { id: number; documentId: string; locale?: string };
    params: { data: Record<string, unknown> };
  }) {
    const { result, params } = event;
    const { id, documentId } = result;

    // Fast path: skip published-row clones without touching the DB. `publish()`
    // (and every nightly re-publish) creates a published row whose create data
    // carries `publishedAt` — it must NOT regenerate the QR. This is the hot path
    // (~one publish per spring per sync run).
    if (params?.data?.publishedAt) {
      return;
    }

    // Idempotency is decided against the DOCUMENT, not `event.result`: media
    // relations are never populated onto the lifecycle result, so the old
    // `if (result.qr_code)` guard never fired. Query the draft row's qr_code.
    //
    // Use `db.query` (NOT the Document Service) so this internal consistency
    // check bypasses the Spring admin-scoping middleware (`spring-scope.ts`): in
    // an admin request context that middleware would AND a `managers` filter onto
    // findOne and could hide an existing QR, causing a spurious regeneration.
    // Same internal-path pattern the ČHMÚ sync already uses (spring.ts).
    const locale =
      result.locale ?? (params?.data?.locale as string | undefined);
    const draft = (await strapi.db.query(SPRING_UID).findOne({
      where: { documentId, publishedAt: null, ...(locale ? { locale } : {}) },
      populate: { qr_code: true },
    })) as { qr_code?: unknown } | null;

    if (
      !shouldGenerateQr({
        publishedAt: params?.data?.publishedAt,
        hasExistingQr: Boolean(draft?.qr_code),
      })
    ) {
      strapi.log.debug(
        `Spring ${documentId}: QR code already exists, skipping generation`,
      );
      return;
    }

    let tempFilePath: string | null = null;

    try {
      strapi.log.info(`Spring ${documentId}: Generating QR code...`);

      // Generate QR code as PNG buffer
      // Using high error correction (H) for durability when printed
      const qrBuffer = await QRCode.toBuffer(documentId, {
        type: "png",
        width: 512,
        margin: 2,
        errorCorrectionLevel: "H",
      });

      // Write buffer to a temporary file (required by Strapi upload service)
      const tempDir = os.tmpdir();
      const fileName = `spring-qr-${documentId}.png`;
      tempFilePath = path.join(tempDir, fileName);
      fs.writeFileSync(tempFilePath, qrBuffer);

      // Create file object that Strapi's upload service expects
      // Based on Strapi's internal enhanceAndValidateFile function
      const fileData = {
        filepath: tempFilePath,
        originalFilename: fileName,
        mimetype: "image/png",
        size: Buffer.byteLength(qrBuffer),
      };

      // Upload to Media Library and link to the Spring entry
      const uploadedFiles = await strapi
        .plugin("upload")
        .service("upload")
        .upload({
          data: {
            refId: id,
            ref: "api::spring.spring",
            field: "qr_code",
          },
          files: fileData,
        });

      strapi.log.info(
        `Spring ${documentId}: QR code uploaded successfully (file id: ${uploadedFiles[0]?.id})`,
      );
    } catch (error) {
      // Log the error but don't throw - let the Spring creation succeed
      // even if QR code generation fails
      strapi.log.error(
        `Spring ${documentId}: Failed to generate/upload QR code`,
        error,
      );
    } finally {
      // Clean up temp file
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        try {
          fs.unlinkSync(tempFilePath);
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  },
};
