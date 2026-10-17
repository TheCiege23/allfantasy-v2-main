import { NextResponse } from "next/server"

import { getRelayRangeSetNode } from "@/lib/geo/privateRelayStore"
import { vpnStatusFromHeaders } from "@/lib/geo/vpnStatus"

export const dynamic = "force-dynamic"

/**
 * What the VPN gate currently thinks of this connection — the "I turned it off,
 * try again" button on /vpn-blocked asks this before navigating, so a person
 * who is still refused is told WHAT is still on instead of watching the same
 * page reload.
 *
 * `?recheck=1` re-asks the vendor about a cached block (throttled per address in
 * lib/geo/anonymizerCache). `?scope=paid` asks about PAID pages, where a
 * Mountain-time Private Relay user is still refused (lib/geo/privateRelayRanges).
 * Reachable over a VPN because middleware exempts all of `/api/geo` from both
 * the geo and the VPN gate.
 *
 * ⚠ Returns only a verdict and a category. Never the vendor payload, never a key.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams
  const fresh = params.get("recheck") === "1"
  const paidScope = params.get("scope") === "paid"
  const status = await vpnStatusFromHeaders(req.headers, { fresh, relayRanges: getRelayRangeSetNode })
  const blocked = status.blocked || (paidScope && status.paidBlocked === true)
  return NextResponse.json(
    { blocked, kind: blocked ? status.kind : null, checkedAt: new Date().toISOString() },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } },
  )
}
