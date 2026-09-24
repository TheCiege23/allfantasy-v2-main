/**
 * SMS program identity — the single source for how AllFantasy's text-message
 * program names itself on the site.
 *
 * ⚠ CARRIER REVIEW COMPARES THESE STRINGS TO THE A2P 10DLC BRAND REGISTRATION.
 * The first campaign submission was rejected because "the opt-in consent is for a
 * different company than the registered brand": the consent language, Terms and
 * Privacy Policy named only "AllFantasy" while the brand is registered to the legal
 * entity. SMS_PROGRAM_OPERATOR must match the legal company name on the Twilio
 * brand registration EXACTLY (Twilio Console → Trust Hub / Messaging → Regulatory
 * Compliance → Brands). If that name changes, change it here; every consent box,
 * the Privacy Policy and the Terms read it from this file.
 *
 * Bump SMS_CONSENT_VERSION whenever SMS_CONSENT_TEXT changes, so the consent
 * record stored on the profile says which wording the user actually agreed to.
 */
export const SMS_PROGRAM_BRAND = "AllFantasy"
export const SMS_PROGRAM_OPERATOR = "Brown Pig LLC"
export const SMS_PROGRAM_SUPPORT_EMAIL = "support@allfantasy.ai"
export const SMS_CONSENT_VERSION = "2026-09-24"

/** Plain-text consent wording, recorded with each opt-in. The checkbox renders the same words with links. */
export const SMS_CONSENT_TEXT =
  `I agree to receive SMS from ${SMS_PROGRAM_BRAND} (operated by ${SMS_PROGRAM_OPERATOR}), ` +
  "including verification codes, account alerts, and optional league notifications. " +
  "Msg frequency varies. Msg & data rates may apply. Reply STOP to opt out, HELP for help. " +
  "Consent is not a condition of purchase. See our Terms and Privacy Policy."
