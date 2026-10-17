import { NextResponse } from "next/server"

import { getRelayRangeSetNode } from "@/lib/geo/privateRelayStore"
import { PRIVATE_RELAY_RANGES_PATH } from "@/lib/geo/privateRelayEdge"
import { INTERNAL_HOP_HEADER, verifyInternalHop } from "@/lib/http/internalHop"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * The stored Apple Private Relay US ranges, for the middleware's in-memory copy
 * (lib/geo/privateRelayEdge). Only our own server may ask — see that module.
 *
 * 404 when nothing is stored (not yet ingested, or expired): the middleware then
 * keeps relay users blocked, which is the behaviour before this existed.
 */
export async function GET(req: Request) {
  const signed =
    req.headers.has(INTERNAL_HOP_HEADER) &&
    (await verifyInternalHop(req.headers, "GET", PRIVATE_RELAY_RANGES_PATH))
  if (!signed) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const set = await getRelayRangeSetNode()
  if (!set) {
    return NextResponse.json({ available: false }, { status: 404, headers: { "Cache-Control": "no-store" } })
  }
  return NextResponse.json(set, { headers: { "Cache-Control": "no-store" } })
}
