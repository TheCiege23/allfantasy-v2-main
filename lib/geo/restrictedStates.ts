// SINGLE SOURCE OF TRUTH for fantasy sports geo-restrictions.
// Update this file only when state laws change.
// Last reviewed: April 2025. `details` reworded Sept 2026 (rules unchanged): it is
// rendered on public pages (/no-gambling-policy, /paid-restricted), and "illegal
// gambling" / "sports wagering" phrasing there read to an A2P 10DLC carrier reviewer
// as a gambling-adjacent business (Twilio 30885). State WHAT is restricted, plainly.

export type RestrictionLevel = "full_block" | "paid_block"

export interface RestrictedState {
  code: string
  name: string
  level: RestrictionLevel
  legalBasis: string
  details: string
  effectiveDate: string
}

export const RESTRICTED_STATES: RestrictedState[] = [
  {
    code: "WA",
    name: "Washington",
    level: "full_block",
    legalBasis: "RCW 9.46.240 (2016 clarification)",
    details:
      "Washington state law prohibits fantasy sports, including free play, so AllFantasy is not available in Washington.",
    effectiveDate: "2016-03-01",
  },
  {
    code: "HI",
    name: "Hawaii",
    level: "paid_block",
    legalBasis: "Hawaii AG Opinion 16-1 (January 2016)",
    details:
      "Hawaii restricts paid fantasy sports. Free accounts and free features are available; subscriptions and paid leagues are not.",
    effectiveDate: "2016-01-01",
  },
  {
    code: "ID",
    name: "Idaho",
    level: "paid_block",
    legalBasis: "Idaho Code §18-3802; Idaho AG Opinion (May 2016)",
    details:
      "Idaho restricts paid fantasy sports. Free accounts and free features are available; subscriptions and paid leagues are not.",
    effectiveDate: "2016-05-01",
  },
  {
    code: "MT",
    name: "Montana",
    level: "paid_block",
    legalBasis: "Montana Code §23-5-802",
    details:
      "Montana restricts paid fantasy sports. Free accounts and free features are available; subscriptions and paid leagues are not.",
    effectiveDate: "2015-11-01",
  },
  {
    code: "NV",
    name: "Nevada",
    level: "paid_block",
    legalBasis: "NV Gaming Control Board (Oct 2015) + NV AG Opinion",
    details:
      "Nevada restricts paid fantasy sports. Free accounts and free features are available; subscriptions and paid leagues are not.",
    effectiveDate: "2015-10-01",
  },
]

export const FULL_BLOCK_STATES = new Set(RESTRICTED_STATES.filter((s) => s.level === "full_block").map((s) => s.code))

export const PAID_BLOCK_STATES = new Set(RESTRICTED_STATES.filter((s) => s.level === "paid_block").map((s) => s.code))

export const ALL_RESTRICTED_STATE_CODES = new Set(RESTRICTED_STATES.map((s) => s.code))

export function getRestrictionLevel(stateCode: string | null | undefined): RestrictionLevel | null {
  if (!stateCode) return null
  const state = RESTRICTED_STATES.find((s) => s.code === stateCode.toUpperCase())
  return state?.level ?? null
}

export function isFullyBlocked(stateCode: string | null | undefined): boolean {
  return FULL_BLOCK_STATES.has((stateCode ?? "").toUpperCase())
}

export function isPaidBlocked(stateCode: string | null | undefined): boolean {
  return PAID_BLOCK_STATES.has((stateCode ?? "").toUpperCase())
}

export function isAnyRestriction(stateCode: string | null | undefined): boolean {
  return ALL_RESTRICTED_STATE_CODES.has((stateCode ?? "").toUpperCase())
}

export function getRestrictedStateMeta(stateCode: string | null | undefined): RestrictedState | undefined {
  if (!stateCode) return undefined
  return RESTRICTED_STATES.find((s) => s.code === stateCode.toUpperCase())
}
