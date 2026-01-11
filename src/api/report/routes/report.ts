/**
 * Custom routes for the Report API.
 *
 * The 'create' action is protected by the 'is-authentic-report' policy
 * which validates HMAC signatures, timestamps, and geo-fencing.
 */

export default {
    routes: [
        // ──────────────────────────────────────────────────────────────────────
        // Public read routes (no additional security)
        // ──────────────────────────────────────────────────────────────────────
        {
            method: "GET",
            path: "/reports",
            handler: "report.find",
        },
        {
            method: "GET",
            path: "/reports/:id",
            handler: "report.findOne",
        },

        // ──────────────────────────────────────────────────────────────────────
        // Protected create route with HMAC + geo-fence validation
        // ──────────────────────────────────────────────────────────────────────
        {
            method: "POST",
            path: "/reports",
            handler: "report.create",
            config: {
                policies: ["api::report.is-authentic-report"],
            },
        },

        // ──────────────────────────────────────────────────────────────────────
        // Admin routes (typically restricted by authentication middleware)
        // ──────────────────────────────────────────────────────────────────────
        {
            method: "PUT",
            path: "/reports/:id",
            handler: "report.update",
        },
        {
            method: "DELETE",
            path: "/reports/:id",
            handler: "report.delete",
        },
    ],
};
