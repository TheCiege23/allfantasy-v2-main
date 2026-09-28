/**
 * The Private Relay ranges as the MIDDLEWARE sees them. The middleware runs on
 * the Edge runtime and cannot reach Postgres, so it asks our own
 * /api/geo/private-relay-ranges (which reads ./privateRelayStore) and keeps the
 * answer in memory for an hour.
 *
 * Asked only when a client has already been judged anonymized, so an ordinary
 * visitor never triggers the fetch. Every failure — timeout, 404 because the
 * feed has not been ingested yet, a malformed body — yields `null`, and `null`
 * means relay users stay blocked, exactly as before this existed.
 *
 * ⚠ The route refuses anything without a valid internal-hop signature: the set
 * is public data, but a megabyte of it per unauthenticated request is not an
 * endpoint worth leaving open.
 */

import { internalHopHeaders } from "@/lib/http/internalHop"
import { isRelayRangeSet, type RelayRangeSet } from "./privateRelayRanges"

export const PRIVATE_RELAY_RANGES_PATH = "/api/geo/private-relay-ranges"

const TTL_MS = 60 * 60 * 1000
const MISS_TTL_MS = 5 * 60 * 1000
const TIMEOUT_MS = 2_000

let cached: { set: RelayRangeSet | null; until: number } | null = null
let warned = false

/**
 * Said once per process: a miss here is silent in effect (relay users stay
 * blocked, which is safe) and would otherwise be invisible. The path and status
 * only — the URL carries no secret, but there is no reason to log more.
 */
function warnOnce(reason: string): void {
  if (warned) return
  warned = true
  console.warn(
    `[geo] Private Relay ranges unavailable to the middleware (${reason}); relay users stay on the ` +
      "VPN page until they load. Logged once per process.",
  )
}
let inFlight: Promise<RelayRangeSet | null> | null = null

/** Test seam. */
export function __resetRelayRangeEdgeCache(): void {
  cached = null
  inFlight = null
  warned = false
}

async function load(origin: string): Promise<RelayRangeSet | null> {
  const url = new URL(PRIVATE_RELAY_RANGES_PATH, origin)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: await internalHopHeaders("GET", url),
    })
    if (!res.ok) {
      warnOnce(`${PRIVATE_RELAY_RANGES_PATH} answered ${res.status}`)
      return null
    }
    const body: unknown = await res.json()
    if (isRelayRangeSet(body)) return body
    warnOnce("malformed body")
    return null
  } catch (err) {
    warnOnce((err as Error)?.name === "AbortError" ? "timed out" : "fetch failed")
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function getRelayRangeSetEdge(origin: string): Promise<RelayRangeSet | null> {
  const now = Date.now()
  if (cached && cached.until > now) return cached.set
  if (inFlight) return inFlight
  inFlight = load(origin)
    .then((set) => {
      cached = { set, until: Date.now() + (set ? TTL_MS : MISS_TTL_MS) }
      return set
    })
    .finally(() => {
      inFlight = null
    })
  return inFlight
}
