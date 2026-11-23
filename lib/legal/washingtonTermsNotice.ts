// Relative, not "@/": scripts/send-terms-update-notice.ts imports this under tsx.
import { LEGAL_LAST_UPDATED_BY_PAGE } from "./legalVersions"
import { arbitrationOptOutDeadline } from "./termsUpdateNotice"

/**
 * The one-time email telling existing account holders about the 2026-11 Terms update: Washington
 * moved from "not available" to a Restricted State (free features open, paid features not).
 *
 * Owner-approved 2026-11-21. Sent by scripts/send-terms-update-notice.ts --notice=2026-11-washington,
 * AFTER the re-dated Terms and State Notice are live, because the links must open the new text.
 *
 * ⚠ It restates the arbitration opt-out because re-dating the Terms restarted that window
 * (Terms 18.9: 30 days from the Effective Date). Both dates are DERIVED from the legalVersions
 * stamp, never typed, so the email cannot disagree with the page it links to.
 *
 * A legal notice, not marketing: it carries the operator's address and why the reader is receiving
 * it, and no unsubscribe, because the Terms (21.1) name email as the channel for notices.
 */

export const WASHINGTON_TERMS_NOTICE_SUBJECT = "An update to our Terms of Service"

export function buildWashingtonTermsNotice(baseUrl: string): { subject: string; html: string; text: string } {
  const base = baseUrl.replace(/\/$/, "")
  const effective = LEGAL_LAST_UPDATED_BY_PAGE.terms
  const deadline = arbitrationOptOutDeadline(effective)
  const link = (path: string, label: string) => `<a href="${base}${path}" style="color:#0e7490;">${label}</a>`

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,Helvetica,sans-serif;color:#111;line-height:1.55;max-width:620px;">
  <p>Hi,</p>
  <p>We've updated the AllFantasy ${link("/terms", "Terms of Service")} and the
  ${link("/disclaimer", "Fantasy Sports &amp; State Notice")}, effective ${effective}.</p>
  <p><strong>What changed:</strong> AllFantasy is now available in Washington State. Anyone in Washington can
  create a free account and use all free features. As in Hawaii, Idaho, Montana and Nevada, subscriptions,
  tokens and paid leagues aren't available there.</p>
  <p>If your account was restricted because it was used in Washington, the free features are open to you
  again. You don't need to do anything.</p>
  <p><strong>Arbitration opt-out:</strong> The Terms still include individual arbitration and a class-action
  waiver (${link("/terms#section-18", "Section 18")}). You can opt out by emailing support@allfantasy.ai by
  <strong>${deadline}</strong> with the subject "Arbitration Opt-Out" and your name, username and email
  address.</p>
  <p>Nothing else changed. By continuing to use AllFantasy, you agree to the updated Terms.</p>
  <p>Questions? support@allfantasy.ai</p>
  <p style="color:#666;font-size:12px;">You're receiving this because you have an AllFantasy account and this
  is a change to the terms that govern it. AllFantasy is operated by Brown Pig LLC, 1621 Central Ave,
  Cheyenne, WY 82001.</p>
</body></html>`

  const text = [
    "Hi,",
    "",
    `We've updated the AllFantasy Terms of Service and the Fantasy Sports & State Notice, effective ${effective}.`,
    "",
    "What changed: AllFantasy is now available in Washington State. Anyone in Washington can create a free account and use all free features. As in Hawaii, Idaho, Montana and Nevada, subscriptions, tokens and paid leagues aren't available there.",
    "",
    "If your account was restricted because it was used in Washington, the free features are open to you again. You don't need to do anything.",
    "",
    `Arbitration opt-out: The Terms still include individual arbitration and a class-action waiver (Section 18). You can opt out by emailing support@allfantasy.ai by ${deadline} with the subject "Arbitration Opt-Out" and your name, username and email address.`,
    "",
    "Nothing else changed. By continuing to use AllFantasy, you agree to the updated Terms.",
    "",
    `Terms: ${base}/terms`,
    `Fantasy Sports & State Notice: ${base}/disclaimer`,
    "",
    "Questions? support@allfantasy.ai",
    "You're receiving this because you have an AllFantasy account and this is a change to the terms that govern it.",
    "AllFantasy is operated by Brown Pig LLC, 1621 Central Ave, Cheyenne, WY 82001.",
  ].join("\n")

  return { subject: WASHINGTON_TERMS_NOTICE_SUBJECT, html, text }
}
