/**
 * Which restricted state, if any, a card's BILLING ADDRESS puts a buyer in.
 *
 * Owner's decision, 2026-09-24: paid-feature states are gated by the card's
 * billing address — not by the signup-state flag, and not only by the request's
 * IP. Every other gate reads where the REQUEST appears to be, which an
 * uncatalogued residential proxy rewrites; the card's billing address is
 * something the buyer's bank has on file and the proxy cannot touch.
 *
 * ⚠ THE ZIP CODE OUTRANKS THE STATE FIELD, AND BOTH COUNT. The postal code is
 * what the card issuer checks (AVS, `address_postal_code_check`); the state is
 * whatever the buyer typed. So the ZIP decides the state when it maps to one we
 * restrict — and a typed restricted state still counts on its own, because a
 * buyer who tells us they live in Nevada has told us they live in Nevada.
 *
 * ⚠ US ONLY, like every other rule here. A billing address outside the US is not
 * a restricted state. A US address with neither a usable ZIP nor a state is
 * UNKNOWN (null), which the caller must not read as "restricted".
 */

import { RESTRICTED_STATES, isAnyRestriction } from "./restrictedStates"

/**
 * First-three-digit ZIP prefixes for every state in RESTRICTED_STATES.
 *
 * Only the restricted states are listed: this answers "is this ZIP in a state
 * we restrict", not "which state is this ZIP in". A state added to
 * RESTRICTED_STATES without a row here fails the coverage test, on purpose —
 * otherwise its buyers would be checked by the typed state field alone.
 *
 * Source: USPS ZIP3 allocation. Unassigned prefixes inside a range (892, 896 in
 * Nevada; 987 in Washington) belong to no other state, so a range is safe.
 */
export const RESTRICTED_STATE_ZIP3_RANGES: Readonly<Record<string, ReadonlyArray<readonly [number, number]>>> = {
  WA: [[980, 994]],
  HI: [[967, 968]],
  ID: [[832, 838]],
  MT: [[590, 599]],
  NV: [[889, 898]],
}

/** The restricted state a US ZIP code belongs to, or null (not restricted, or not a ZIP). */
export function restrictedStateForZip(postalCode: string | null | undefined): string | null {
  const match = /^\s*(\d{5})(?:[\s-]?\d{4})?\s*$/.exec(postalCode ?? "")
  if (!match) return null
  const zip3 = Number(match[1].slice(0, 3))
  for (const [state, ranges] of Object.entries(RESTRICTED_STATE_ZIP3_RANGES)) {
    if (ranges.some(([lo, hi]) => zip3 >= lo && zip3 <= hi)) return state
  }
  return null
}

/** A typed state as a two-letter code: "NV", "nv" and "Nevada" all read as NV. */
function normalizeTypedState(state: string | null | undefined): string | null {
  const raw = (state ?? "").trim()
  if (!raw) return null
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase()
  const byName = RESTRICTED_STATES.find((s) => s.name.toLowerCase() === raw.toLowerCase())
  return byName?.code ?? null
}

export interface BillingAddressLike {
  country?: string | null
  postal_code?: string | null
  state?: string | null
}

export interface RestrictedBillingState {
  stateCode: string
  /** Which field decided it — the ZIP (bank-verified) or the typed state. */
  source: "postal_code" | "state"
}

/**
 * The restricted state this billing address is in, or null when it is in none —
 * or when there is not enough of an address to tell.
 */
export function restrictedBillingState(address: BillingAddressLike | null | undefined): RestrictedBillingState | null {
  if (!address) return null
  if ((address.country ?? "").trim().toUpperCase() !== "US") return null

  const fromZip = restrictedStateForZip(address.postal_code)
  if (fromZip) return { stateCode: fromZip, source: "postal_code" }

  const typed = normalizeTypedState(address.state)
  if (typed && isAnyRestriction(typed)) return { stateCode: typed, source: "state" }

  return null
}
