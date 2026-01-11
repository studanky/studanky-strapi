import type { Core } from "@strapi/strapi";
import crypto from "crypto";
import { haversineDistance } from "../../../utils/geo";

/**
 * Policy: is-authentic-report
 *
 * A multi-layered security policy for the Report creation endpoint.
 * Validates requests using:
 * 1. HMAC-SHA256 signature verification
 * 2. Timestamp validation (replay attack protection)
 * 3. Geo-fence validation (proximity to Spring)
 */

// Configuration
const TIMESTAMP_MAX_AGE_SECONDS = 5 * 60; // 5 minutes
const MAX_DISTANCE_METERS = 500;

interface ReportRequestBody {
    data: {
        spring: string; // documentId of the spring
        user_lat?: number;
        user_lng?: number;
        is_flowing: boolean;
        flow_strength: string;
        has_odor: boolean;
        water_clarity: string;
        reported_at: string;
        device_id: string;
        note?: string;
    };
}

interface SpringDocument {
    documentId: string;
    lat: number;
    lng: number;
}

/**
 * Generates the expected HMAC signature for comparison.
 *
 * Signature payload format: "{timestamp}:{springDocumentId}"
 */
function generateExpectedSignature(
    timestamp: string,
    springDocumentId: string,
    secret: string
): string {
    const payload = `${timestamp}:${springDocumentId}`;
    return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Validates that the timestamp is within the allowed window.
 */
function isTimestampValid(timestamp: number): boolean {
    const now = Math.floor(Date.now() / 1000);
    const age = now - timestamp;
    return age >= 0 && age <= TIMESTAMP_MAX_AGE_SECONDS;
}

export default async (
    policyContext: Core.PolicyContext,
    _config: unknown,
    { strapi }: { strapi: Core.Strapi }
) => {
    const ctx = policyContext as unknown as {
        request: {
            header: Record<string, string | undefined>;
            body: ReportRequestBody;
        };
    };

    // ──────────────────────────────────────────────────────────────────────────
    // 1. Extract and validate required headers
    // ──────────────────────────────────────────────────────────────────────────

    const signature = ctx.request.header["x-app-signature"];
    const timestampHeader = ctx.request.header["x-timestamp"];

    if (!signature) {
        strapi.log.warn("Report rejected: Missing X-App-Signature header");
        return false;
    }

    if (!timestampHeader) {
        strapi.log.warn("Report rejected: Missing X-Timestamp header");
        return false;
    }

    const timestamp = parseInt(timestampHeader, 10);
    if (isNaN(timestamp)) {
        strapi.log.warn("Report rejected: Invalid X-Timestamp format");
        return false;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 2. Validate timestamp (replay attack protection)
    // ──────────────────────────────────────────────────────────────────────────

    if (!isTimestampValid(timestamp)) {
        strapi.log.warn(
            `Report rejected: Timestamp expired or invalid (age: ${Math.floor(Date.now() / 1000) - timestamp}s)`
        );
        return false;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 3. Extract request body data
    // ──────────────────────────────────────────────────────────────────────────

    const body = ctx.request.body;
    const springDocumentId = body?.data?.spring;

    if (!springDocumentId) {
        strapi.log.warn("Report rejected: Missing spring documentId in request body");
        return false;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 4. Validate HMAC signature
    // ──────────────────────────────────────────────────────────────────────────

    const hmacSecret = process.env.HMAC_SECRET;
    if (!hmacSecret) {
        strapi.log.error("HMAC_SECRET environment variable is not configured");
        return false;
    }

    const expectedSignature = generateExpectedSignature(
        timestampHeader,
        springDocumentId,
        hmacSecret
    );

    // Use timing-safe comparison to prevent timing attacks
    const signatureBuffer = Buffer.from(signature, "hex");
    const expectedBuffer = Buffer.from(expectedSignature, "hex");

    if (
        signatureBuffer.length !== expectedBuffer.length ||
        !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
        strapi.log.warn(
            `Report rejected: Invalid signature for spring ${springDocumentId}`
        );
        return false;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 5. Geo-fence validation
    // ──────────────────────────────────────────────────────────────────────────

    const userLat = body?.data?.user_lat;
    const userLng = body?.data?.user_lng;

    // If user coordinates are provided, validate proximity
    if (userLat !== undefined && userLng !== undefined) {
        // Fetch the Spring's coordinates using Strapi v5 Document Service
        const spring = (await strapi.documents("api::spring.spring").findOne({
            documentId: springDocumentId,
            fields: ["lat", "lng"],
            status: "published",
        })) as SpringDocument | null;

        if (!spring) {
            strapi.log.warn(
                `Report rejected: Spring not found with documentId ${springDocumentId}`
            );
            return false;
        }

        const distance = haversineDistance(
            userLat,
            userLng,
            spring.lat,
            spring.lng
        );

        if (distance > MAX_DISTANCE_METERS) {
            strapi.log.warn(
                `Report rejected: User location too far from spring (${Math.round(distance)}m > ${MAX_DISTANCE_METERS}m)`
            );
            return false;
        }

        strapi.log.debug(
            `Report geo-validation passed: ${Math.round(distance)}m from spring ${springDocumentId}`
        );
    } else {
        strapi.log.debug(
            `Report for spring ${springDocumentId}: No user coordinates provided, skipping geo-validation`
        );
    }

    // All validations passed
    strapi.log.info(
        `Report authenticated successfully for spring ${springDocumentId}`
    );
    return true;
};
