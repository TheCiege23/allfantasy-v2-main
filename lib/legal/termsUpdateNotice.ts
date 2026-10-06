// Relative, not "@/": scripts/send-terms-update-notice.ts imports this under tsx.
import { LEGAL_LAST_UPDATED_BY_PAGE } from "./legalVersions"

/**
 * The one-time email telling existing account holders about the 2026-10 legal documents.
 *
 * Owner-approved 2026-10-06. Sent by scripts/send-terms-update-notice.ts AFTER the documents are
 * live, because every link below must open the new text. A legal notice, not marketing: it carries
 * the operator's address and why the reader is receiving it, and no unsubscribe, because the Terms
 * (21.1) name email as the channel for notices.
 *
 * ⚠ THE DATES ARE DERIVED, NOT TYPED. The effective date is the legalVersions stamp the documents
 * print, and the arbitration opt-out deadline is 30 days after it (Terms 18.9 gives existing users
 * 30 days from the Effective Date). Change the stamp and this email follows.
 */

const EFFECTIVE = LEGAL_LAST_UPDATED_BY_PAGE.terms

/** Terms 18.9: existing users may opt out within 30 days after the Effective Date. */
export function arbitrationOptOutDeadline(effective: string = EFFECTIVE): string {
  const d = new Date(`${effective} 00:00:00 UTC`)
  if (Number.isNaN(d.getTime())) throw new Error(`Unparseable effective date: ${effective}`)
  d.setUTCDate(d.getUTCDate() + 30)
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })
}

export const TERMS_UPDATE_SUBJECT = "We've updated our Terms of Service and Privacy Policy"

export function buildTermsUpdateNotice(baseUrl: string): { subject: string; html: string; text: string } {
  const base = baseUrl.replace(/\/$/, "")
  const deadline = arbitrationOptOutDeadline()
  const link = (path: string, label: string) => `<a href="${base}${path}" style="color:#0e7490;">${label}</a>`

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,Helvetica,sans-serif;color:#111;line-height:1.55;max-width:620px;">
  <p>Hi,</p>
  <p>We've updated the AllFantasy ${link("/terms", "Terms of Service")} and ${link("/privacy", "Privacy Policy")},
  effective ${EFFECTIVE}, and published three companion documents: the ${link("/sms-terms", "SMS Terms")},
  the ${link("/copyright", "Copyright Policy")}, and the ${link("/disclaimer", "Fantasy Sports &amp; State Notice")}.
  Here is what changed.</p>
  <ul>
    <li><strong>Disputes go to individual arbitration.</strong> The Terms now include an agreement to resolve
    disputes through binding individual arbitration, a class-action waiver, and a jury-trial waiver
    (${link("/terms#section-18", "Section 18")}). <strong>You can opt out</strong> by emailing
    support@allfantasy.ai by <strong>${deadline}</strong> with the subject "Arbitration Opt-Out" and your name,
    username, and email address.</li>
    <li><strong>Subscriptions renew automatically</strong> until you cancel, which you can do any time in
    Settings → Billing. We'll email you before an annual plan renews.</li>
    <li><strong>Chimmy and our other AI features</strong> are information, not advice, and can be wrong.</li>
    <li><strong>Your privacy choices.</strong> You can opt out of the advertising measurement we use on the
    website on the new ${link("/privacy/choices", "Your Privacy Choices")} page, and we honor your browser's
    Global Privacy Control signal.</li>
    <li><strong>Connected platforms.</strong> We never ask for or store your password for another fantasy
    platform, and deleting your account now deletes the connections you saved.</li>
  </ul>
  <p>Nothing changes about how AllFantasy works day to day: it is season-long fantasy sports only, with no
  gambling, no daily fantasy, and no prizes. By continuing to use AllFantasy, you agree to the updated Terms.
  If you don't agree, you can delete your account in Settings → Account.</p>
  <p>Questions? Email support@allfantasy.ai.</p>
  <p style="color:#666;font-size:12px;">You're receiving this because you have an AllFantasy account and these
  are changes to the terms that govern it. AllFantasy is operated by Brown Pig LLC, 1621 Central Ave,
  Cheyenne, WY 82001.</p>
</body></html>`

  const text = [
    "Hi,",
    "",
    `We've updated the AllFantasy Terms of Service and Privacy Policy, effective ${EFFECTIVE}, and published the SMS Terms, the Copyright Policy, and the Fantasy Sports & State Notice.`,
    "",
    `- Disputes go to individual arbitration (Terms Section 18), with a class-action and jury-trial waiver. You can opt out by emailing support@allfantasy.ai by ${deadline} with the subject "Arbitration Opt-Out" and your name, username, and email address.`,
    "- Subscriptions renew automatically until you cancel (Settings > Billing). We'll email you before an annual plan renews.",
    "- Chimmy and our other AI features are information, not advice, and can be wrong.",
    `- You can opt out of advertising measurement at ${base}/privacy/choices, and we honor Global Privacy Control.`,
    "- We never ask for or store your password for another fantasy platform, and deleting your account deletes the connections you saved.",
    "",
    "By continuing to use AllFantasy, you agree to the updated Terms. If you don't agree, you can delete your account in Settings > Account.",
    "",
    `Terms: ${base}/terms`,
    `Privacy: ${base}/privacy`,
    `SMS Terms: ${base}/sms-terms`,
    `Copyright Policy: ${base}/copyright`,
    `Fantasy Sports & State Notice: ${base}/disclaimer`,
    "",
    "Questions? support@allfantasy.ai",
    "AllFantasy is operated by Brown Pig LLC, 1621 Central Ave, Cheyenne, WY 82001.",
  ].join("\n")

  return { subject: TERMS_UPDATE_SUBJECT, html, text }
}
