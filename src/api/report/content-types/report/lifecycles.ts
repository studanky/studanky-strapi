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
        spring?: { count: number } | { id: number; documentId: string } | null;
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
        const { result, params } = event;
        const { documentId: reportDocId, is_flowing, reported_at } = result;

        // -------------------------------------------------------------------------
        // Resolve Spring documentId
        // The spring relation is NOT auto-populated in afterCreate result.
        // We need to extract it from various possible sources.
        // -------------------------------------------------------------------------
        let springDocumentId: string | null = null;

        // Check if spring is in result with documentId
        if (
            result.spring &&
            typeof result.spring === 'object' &&
            'documentId' in result.spring
        ) {
            springDocumentId = result.spring.documentId;
        }

        // Try to get it from params.data (connect or set operations)
        if (!springDocumentId && params.data?.spring) {
            const springData = params.data.spring as {
                documentId?: string;
                connect?: Array<{ documentId?: string; id?: number }>;
                set?: Array<{ documentId?: string; id?: number }>;
            };
            if (springData.documentId) {
                springDocumentId = springData.documentId;
            } else if (springData.connect?.[0]?.documentId) {
                springDocumentId = springData.connect[0].documentId;
            } else if (springData.set?.[0]?.documentId) {
                springDocumentId = springData.set[0].documentId;
            }
        }

        // Last resort: fetch the report with spring relation populated
        if (!springDocumentId) {
            const fullReport = (await strapi.documents('api::report.report').findOne({
                documentId: reportDocId,
                populate: ['spring'],
            })) as { spring?: { documentId: string } } | null;

            if (fullReport?.spring?.documentId) {
                springDocumentId = fullReport.spring.documentId;
            }
        }

        // -------------------------------------------------------------------------
        // Guard: Skip if no Spring is linked
        // -------------------------------------------------------------------------
        if (!springDocumentId) {
            strapi.log.debug(
                `Report ${reportDocId}: No spring linked, skipping status propagation`
            );
            return;
        }

        try {
            strapi.log.info(
                `Report ${reportDocId}: Propagating status to Spring ${springDocumentId}`
            );

            // -----------------------------------------------------------------------
            // Fetch draft version (always exists for draftAndPublish content types)
            // -----------------------------------------------------------------------
            const springDraft = (await strapi
                .documents('api::spring.spring')
                .findOne({
                    documentId: springDocumentId,
                    status: 'draft',
                    fields: ['current_status', 'status_updated_at'],
                })) as SpringDocument | null;

            if (!springDraft) {
                strapi.log.warn(
                    `Report ${reportDocId}: Spring ${springDocumentId} draft not found, skipping`
                );
                return;
            }

            // -----------------------------------------------------------------------
            // Fetch published version (may be null if never published)
            // -----------------------------------------------------------------------
            const springPublished = (await strapi
                .documents('api::spring.spring')
                .findOne({
                    documentId: springDocumentId,
                    status: 'published',
                    fields: ['current_status', 'status_updated_at'],
                })) as SpringDocument | null;

            // -----------------------------------------------------------------------
            // Newer-Than Rule: Only update if this report is strictly newer
            // Compare against the published version if exists, otherwise draft
            // -----------------------------------------------------------------------
            const referenceDoc = springPublished || springDraft;
            const reportedAtDate = new Date(reported_at);
            const statusUpdatedAtDate = referenceDoc.status_updated_at
                ? new Date(referenceDoc.status_updated_at)
                : null;

            if (statusUpdatedAtDate && reportedAtDate <= statusUpdatedAtDate) {
                strapi.log.info(
                    `Report ${reportDocId}: Skipping - report (${reported_at}) is not newer than Spring status (${referenceDoc.status_updated_at})`
                );
                return;
            }

            // -----------------------------------------------------------------------
            // Map is_flowing boolean to current_status enum
            // -----------------------------------------------------------------------
            const newStatus: SpringStatus = is_flowing
                ? 'is_flowing'
                : 'is_not_flowing';

            const updateData = {
                current_status: newStatus,
                status_updated_at: reported_at,
            };

            // -----------------------------------------------------------------------
            // Update logic based on publication state:
            // - Draft only → update draft only (via Document Service)
            // - Published exists → update BOTH independently:
            //   - Published: use db.query() to avoid syncing draft changes
            //   - Draft: use Document Service (safe for draft)
            // -----------------------------------------------------------------------

            if (!springPublished) {
                // Spring was never published → update draft only
                await strapi.documents('api::spring.spring').update({
                    documentId: springDocumentId,
                    data: updateData,
                });

                strapi.log.info(
                    `Report ${reportDocId}: Updated Spring ${springDocumentId} draft to ${newStatus} (not published yet)`
                );
            } else {
                // Published version exists → update both independently

                // 1. Update published version using db.query() to bypass draft sync
                // This is critical: Document Service would sync all draft changes!
                await strapi.db.query('api::spring.spring').update({
                    where: {
                        documentId: springDocumentId,
                        publishedAt: { $notNull: true },
                    },
                    data: {
                        current_status: newStatus,
                        status_updated_at: reported_at,
                        updatedAt: new Date().toISOString(),
                    },
                });

                strapi.log.info(
                    `Report ${reportDocId}: Updated Spring ${springDocumentId} published version to ${newStatus} (db.query)`
                );

                // 2. Update draft version using Document Service
                // This only updates current_status and status_updated_at,
                // preserving any other uncommitted changes in the draft
                await strapi.documents('api::spring.spring').update({
                    documentId: springDocumentId,
                    data: updateData,
                });

                strapi.log.info(
                    `Report ${reportDocId}: Updated Spring ${springDocumentId} draft to ${newStatus}`
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
