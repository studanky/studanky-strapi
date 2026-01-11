import QRCode from "qrcode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/**
 * Lifecycle hooks for the Spring content type.
 *
 * Automatically generates a QR code containing the documentId when a new
 * Spring entry is created. The QR code is uploaded to the Media Library
 * and linked to the Spring's qr_code field.
 */
export default {
  async afterCreate(event: {
    result: { id: number; documentId: string; qr_code?: unknown };
    params: { data: Record<string, unknown> };
  }) {
    const { result } = event;
    const { id, documentId, qr_code } = result;

    // Prevent infinite loop: skip if qr_code is already set
    // This can happen if the upload service triggers another lifecycle event
    if (qr_code) {
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
