import { NextResponse } from "next/server"

import { detectUserState } from "./detectUserState"
import { isPaidBlocked } from "./restrictedStates"

export interface PaidGeoOptions {
  /**
   * Refuse a VPN or proxy regardless of the state it resolves to. Default true.
   *
   * ⚠ WHY "REGARDLESS OF STATE". The state comes from the same IP the VPN
   * replaces, so a Washington user on an Oregon exit resolves to OR. The signup
   * check requires the VPN to resolve to a RESTRICTED state, which is exactly
   * the case a VPN user avoids — it can never fire for the evasion it names.
   *
   * Pass `false` only where refusing would trap a paying user: the billing
   * portal is where subscriptions are cancelled, and cancelling must never
   * depend on turning a VPN off.
   */
  blockVpnOrProxy?: boolean
}

/** Returns a 451 JSON response when paid checkout must be blocked; otherwise null. */
export async function enforcePaidSubscriptionGeo(
  req: Request,
  { blockVpnOrProxy = true }: PaidGeoOptions = {},
): Promise<NextResponse | null> {
  const geo = await detectUserState(req)
  if (geo.stateCode && isPaidBlocked(geo.stateCode)) {
    return NextResponse.json(
      {
        error: "PAID_GEO_BLOCKED",
        stateCode: geo.stateCode,
        message: "Paid subscriptions are not available in your state.",
        redirectTo: "/paid-restricted",
        allowFree: true,
      },
      { status: 451 }
    )
  }
  // Fails open by construction: `isVpnOrProxy` is false when no key is set or
  // the vendor is unreachable, so an outage never closes checkout.
  if (blockVpnOrProxy && geo.isVpnOrProxy) {
    return NextResponse.json(
      {
        error: "VPN_BLOCKED",
        message:
          "Purchases aren't available over a VPN or proxy, because we have to confirm which state you're in. Turn off your VPN, proxy or iCloud Private Relay and try again.",
        allowFree: true,
      },
      { status: 451 }
    )
  }
  return null
}
