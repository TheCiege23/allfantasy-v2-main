import { RESTRICTED_STATES } from "@/lib/geo/restrictedStates"

export interface LegalContentSection {
  heading: string
  body: string
}

export const DISCLAIMER_PAGE_TITLE = "Disclaimer"

/**
 * ⚠ THE STATE LIST IS DERIVED, NOT TYPED OUT. It used to read "Washington
 * prohibits all fantasy sports under state law; HI, ID, MT, NV restrict paid
 * fantasy contests", which was a third hand-maintained copy of
 * lib/geo/restrictedStates.ts — a file whose own header says it is the SINGLE
 * SOURCE OF TRUTH and to "update this file only when state laws change".
 *
 * That is the failure mode worth designing out: someone does exactly what that
 * header tells them, the geo-block and /no-gambling-policy and /paid-restricted
 * all follow because they read the array, and the Disclaimer keeps stating the
 * old law — on the page whose entire job is to state the law correctly.
 */
function describeRestrictedStates(): string {
  const named = (level: string) =>
    RESTRICTED_STATES.filter((s) => s.level === level)
      .map((s) => s.code)
      .join(", ")
  const full = named("full_block")
  const paid = named("paid_block")
  return `${full} prohibits all fantasy sports under state law; ${paid} restrict paid fantasy contests — see the state law section above for details.`
}

export const DISCLAIMER_PAGE_SECTIONS: LegalContentSection[] = [
  {
    heading: "State law compliance",
    body: describeRestrictedStates(),
  },
  {
    heading: "Purpose of the Platform",
    body: "AllFantasy is for fantasy sports entertainment and management tools only.",
  },
  {
    heading: "No Gambling or DFS",
    body: "AllFantasy does not offer gambling, betting, DFS, or paid pick'em products.",
  },
  {
    heading: "League Dues and Payments",
    body: "AllFantasy does not process league dues, host prize pools, or distribute payouts directly; paid-league payments are external (e.g., FanCred).",
  },
  {
    heading: "AI Tools and Guidance",
    body: "AI outputs are informational guidance, not guaranteed outcomes.",
  },
  {
    heading: "Your Responsibility and Local Laws",
    body: "Users are responsible for compliance with local laws in their jurisdiction.",
  },
]
