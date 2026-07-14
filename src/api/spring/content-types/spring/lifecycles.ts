import QRCode from "qrcode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { normalizeSearchText } from "../../../../utils/search";

const SPRING_UID = "api::spring.spring";

const syncNameSearch = (data: Record<string, unknown>) => {
  const attributes = strapi.contentTypes[SPRING_UID]?.attributes as
    | Record<string, unknown>
    | undefined;

  if (
    typeof data.name === "string" &&
    attributes?.["name_search"]
  ) {
    data.name_search = normalizeSearchText(data.name);
  }
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
  },

  async beforeUpdate(event: { params: { data: Record<string, unknown> } }) {
    syncNameSearch(event.params.data);
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
        `Spring ${documentId}: QR code already exists, skipping generation`
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
        `Spring ${documentId}: QR code uploaded successfully (file id: ${uploadedFiles[0]?.id})`
      );
    } catch (error) {
      // Log the error but don't throw - let the Spring creation succeed
      // even if QR code generation fails
      strapi.log.error(
        `Spring ${documentId}: Failed to generate/upload QR code`,
        error
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
