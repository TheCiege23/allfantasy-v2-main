import { NextResponse } from "next/server"

import { vpnStatusFromHeaders } from "@/lib/geo/vpnStatus"

export const dynamic = "force-dynamic"

/**
 * What the VPN gate currently thinks of this connection — the "I turned it off,
 * try again" button on /vpn-blocked asks this before navigating, so a person
 * who is still refused is told WHAT is still on instead of watching the same
 * page reload.
 *
 * `?recheck=1` re-asks the vendor about a cached block (throttled per address in
 * lib/geo/anonymizerCache). Reachable over a VPN because middleware exempts all
 * of `/api/geo` from both the geo and the VPN gate.
 *
 * ⚠ Returns only a verdict and a category. Never the vendor payload, never a key.
 */
export async function GET(req: Request) {
  const fresh = new URL(req.url).searchParams.get("recheck") === "1"
  const status = await vpnStatusFromHeaders(req.headers, { fresh })
  return NextResponse.json(
    { blocked: status.blocked, kind: status.kind, checkedAt: new Date().toISOString() },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } },
  )
}
