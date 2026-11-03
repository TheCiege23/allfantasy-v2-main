import { detectUserState } from "./detectUserState"
import { readAccountGeoLockFresh } from "./accountGeoLockServer"
import { getRestrictedStateMeta, isPaidBlocked } from "./restrictedStates"

export interface PaidLeagueGeoVerdict {
  blocked: boolean
  /** Two-letter state, when the block comes from one. */
  stateCode: string | null
  stateName: string | null
  reason: "state" | "account" | "privacy_relay" | null
}

const OPEN: PaidLeagueGeoVerdict = { blocked: false, stateCode: null, stateName: null, reason: null }

/**
 * May this viewer see and join PAID leagues? Paid fantasy leagues are restricted in some states
 * (lib/geo/restrictedStates.ts), and Find a League is where a stranger would otherwise find one.
 *
 * Three signals, any one of which blocks:
 * - the request's state (Cloudflare/Vercel headers, then IP);
 * - an account locked by its billing state, which a VPN does not move;
 * - iCloud Private Relay placed in a Mountain-time state, which could be Idaho or Montana.
 *
 * Unlike checkout this does NOT refuse a VPN outright: the leagues are free to browse, and a
 * VPN user still meets the account lock. It fails OPEN on a detection error, as every geo check
 * here does — the join route is the second gate.
 */
export async function paidLeagueGeoVerdict(req: Request, userId: string | null): Promise<PaidLeagueGeoVerdict> {
  try {
    const [geo, lock] = await Promise.all([
      detectUserState(req),
      userId ? readAccountGeoLockFresh(userId).catch(() => undefined) : Promise.resolve(undefined),
    ])
    if (geo.stateCode && isPaidBlocked(geo.stateCode)) {
      return { blocked: true, stateCode: geo.stateCode, stateName: getRestrictedStateMeta(geo.stateCode)?.name ?? null, reason: "state" }
    }
    if (lock) return { blocked: true, stateCode: null, stateName: null, reason: "account" }
    if (geo.privateRelay?.paidBlocked) return { blocked: true, stateCode: null, stateName: null, reason: "privacy_relay" }
    return OPEN
  } catch {
    return OPEN
  }
}

/** One sentence: "browse" explains why paid leagues are missing, "join" refuses one. */
export function paidLeagueGeoMessage(verdict: PaidLeagueGeoVerdict, context: "browse" | "join" = "browse"): string {
  const consequence = context === "join" ? "so you can't join this one" : "so they're hidden here"
  if (verdict.reason === "state") {
    return `Paid leagues aren't available in ${verdict.stateName ?? "your state"}, ${consequence}. Free leagues are open to you.`
  }
  if (verdict.reason === "privacy_relay") {
    return `Paid leagues aren't available while iCloud Private Relay hides which state you're in, ${consequence}. Free leagues are open to you.`
  }
  return `Paid leagues aren't available on your account because of where it's registered, ${consequence}. Free leagues are open to you.`
}
