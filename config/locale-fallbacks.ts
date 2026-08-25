/**
 * Preferred regional variants used only when the requested Flutter language
 * tag has no exact/base match. Codes absent from Strapi i18n configuration are
 * ignored; remaining same-language variants follow in stable lexical order.
 */
export default {
  preferredVariants: {
    en: ["en-US", "en-GB"],
  },
};
