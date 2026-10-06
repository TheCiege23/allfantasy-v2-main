/**
 * Per-route last-updated stamps. Privacy and Terms carry September 2026 for the
 * SMS program disclosures (A2P 10DLC resubmission; Privacy was August 2026 for the
 * Discord integration before that); the other routes are unchanged since March 2026.
 *
 * dataDeletion moved to September 2026 when the page was corrected to lead with the
 * self-serve Settings → Account flow: it had been telling users (and App Review)
 * that deletion was email-only long after the button shipped. Privacy moved in the
 * same pass to name TikTok and Reddit, which load from inside the GTM container and
 * so were never visible in this repo — it was already stamped September 2026.
 *
 * ⚠ THIS IS ALSO THE VERSION A USER AGREED TO. lib/legal/recordLegalAcceptance stores the stamp
 * beside every acceptance, so bump it in the same change that edits a page's terms — an
 * acceptance recorded against a stale stamp claims agreement to text the user never saw.
 *
 * Lives here (pure, no CSS) rather than in LegalPageShell so server code — the sign-up route —
 * can read it without importing a component and its stylesheet.
 */
/**
 * 2026-10: the owner's rewritten document set — Terms of Service, Privacy Policy, the
 * Fantasy Sports & State Notice (served at /disclaimer), and two new documents, the
 * SMS Terms and the Copyright Policy. All five share one effective date and print it
 * as "Effective: …" rather than "Last updated: …", because the drafts state an
 * effective date and the Terms' arbitration opt-out window runs from it.
 */
const DOCUMENT_SET_2026_10_EFFECTIVE = "October 6, 2026"

export const LEGAL_LAST_UPDATED_BY_PAGE = {
  privacy: DOCUMENT_SET_2026_10_EFFECTIVE,
  terms: DOCUMENT_SET_2026_10_EFFECTIVE,
  disclaimer: DOCUMENT_SET_2026_10_EFFECTIVE,
  smsTerms: DOCUMENT_SET_2026_10_EFFECTIVE,
  copyright: DOCUMENT_SET_2026_10_EFFECTIVE,
  dataDeletion: "September 2026",
  aiTransparency: "March 2026",
  contact: "March 2026",
  mission: "March 2026",
  noGamblingPolicy: "March 2026",
} as const

export type LegalPageKey = keyof typeof LEGAL_LAST_UPDATED_BY_PAGE

/** The last-updated stamp for one legal route. */
export function legalLastUpdated(page: LegalPageKey): string {
  return LEGAL_LAST_UPDATED_BY_PAGE[page]
}
