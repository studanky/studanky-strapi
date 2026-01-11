/**
 * Lifecycle hooks for the Report content type.
 *
 * Automatically propagates is_flowing status to the parent Spring entity
 * when a Report is created. Implements the "newer-than" rule: Spring is
 * only updated if Report.reported_at > Spring.status_updated_at.
 */

// =============================================================================
// Types
// =============================================================================

/** Spring status enum values matching the schema */
type SpringStatus = 'is_flowing' | 'is_not_flowing' | 'unknown';

/** Report lifecycle event from Strapi v5 */
interface ReportAfterCreateEvent {
    result: {
        id: number;
        documentId: string;
        is_flowing: boolean;
        reported_at: string;
        spring?: {
            id: number;
            documentId: string;
        } | null;
    };
    params: {
        data: Record<string, unknown>;
        populate?: unknown;
    };
}

/** Spring document structure (partial, only fields we need) */
interface SpringDocument {
    id: number;
    documentId: string;
    current_status: SpringStatus;
    status_updated_at: string | null;
    publishedAt: string | null;
    locale: string;
}

// =============================================================================
// Lifecycle Hooks
// =============================================================================

export default {
    /**
     * After a Report is created, propagate its status to the parent Spring
     * if the report is newer than the Spring's current status.
     */
    async afterCreate(event: ReportAfterCreateEvent) {
        const { result } = event;
        const { documentId: reportDocId, is_flowing, reported_at, spring } = result;

        // ---------------------------------------------------------------------
        // Guard: Skip if no Spring is linked
        // ---------------------------------------------------------------------
        if (!spring?.documentId) {
            strapi.log.debug(
                `Report ${reportDocId}: No spring linked, skipping status propagation`
            );
            return;
        }

        const springDocumentId = spring.documentId;

        try {
            strapi.log.info(
                `Report ${reportDocId}: Propagating status to Spring ${springDocumentId}`
            );

            // -------------------------------------------------------------------
            // Fetch the current Spring document (draft version by default)
            // We need to check status_updated_at and publishedAt
            // -------------------------------------------------------------------
            const springDoc = (await strapi
                .documents('api::spring.spring')
                .findOne({
                    documentId: springDocumentId,
                    fields: ['current_status', 'status_updated_at', 'publishedAt'],
                })) as SpringDocument | null;

            if (!springDoc) {
                strapi.log.warn(
                    `Report ${reportDocId}: Spring ${springDocumentId} not found, skipping`
                );
                return;
            }

            // -------------------------------------------------------------------
            // Newer-Than Rule: Only update if this report is strictly newer
            // If status_updated_at is null (first report), always update
            // -------------------------------------------------------------------
            const reportedAtDate = new Date(reported_at);
            const statusUpdatedAtDate = springDoc.status_updated_at
                ? new Date(springDoc.status_updated_at)
                : null;

            if (statusUpdatedAtDate && reportedAtDate <= statusUpdatedAtDate) {
                strapi.log.info(
                    `Report ${reportDocId}: Skipping - report (${reported_at}) is not newer than Spring status (${springDoc.status_updated_at})`
                );
                return;
            }

            // -------------------------------------------------------------------
            // Map is_flowing boolean to current_status enum
            // -------------------------------------------------------------------
            const newStatus: SpringStatus = is_flowing
                ? 'is_flowing'
                : 'is_not_flowing';

            const updateData = {
                current_status: newStatus,
                status_updated_at: reported_at,
            };

            // -------------------------------------------------------------------
            // Update the draft version (always exists)
            // -------------------------------------------------------------------
            await strapi.documents('api::spring.spring').update({
                documentId: springDocumentId,
                data: updateData,
            });

            strapi.log.info(
                `Report ${reportDocId}: Updated Spring ${springDocumentId} draft to ${newStatus}`
            );

            // -------------------------------------------------------------------
            // If Spring was already published, also update the published version
            // This keeps both draft and published in sync
            // -------------------------------------------------------------------
            if (springDoc.publishedAt) {
                await strapi.documents('api::spring.spring').update({
                    documentId: springDocumentId,
                    data: updateData,
                    status: 'published',
                });

                strapi.log.info(
                    `Report ${reportDocId}: Also updated Spring ${springDocumentId} published version`
                );
            }
        } catch (error) {
            // Log the error but don't throw - let the Report creation succeed
            // even if status propagation fails
            strapi.log.error(
                `Report ${reportDocId}: Failed to propagate status to Spring ${springDocumentId}`,
                error
            );
        }
    },
};
