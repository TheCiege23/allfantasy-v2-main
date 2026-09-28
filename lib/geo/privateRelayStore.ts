/**
 * Where the parsed Private Relay ranges live: one `SportsDataCache` row, written
 * by ./privateRelayIngest and read here. Node only (Prisma).
 *
 * ⚠ THE ROW EXPIRES 30 DAYS AFTER THE FETCH IT HOLDS, AND THAT IS A SAFETY
 * FEATURE. The hourly reaper refreshes it daily; if refreshing stops, the row
 * goes past `expiresAt`, is ignored here (and eventually purged), and relay
 * users fall back to being blocked — never to being placed by a month-old map
 * of addresses Apple may have moved to another state.
 */

import { isRelayRangeSet, type RelayRangeSet } from "./privateRelayRanges"

export const PRIVATE_RELAY_CACHE_KEY = "geo:apple-private-relay:us-ranges:v1"
export const PRIVATE_RELAY_STORE_TTL_MS = 30 * 24 * 60 * 60 * 1000

/** How long a process keeps the set it read before reading again. */
const PROCESS_TTL_MS = 30 * 60 * 1000
/** After a failed or empty read, try again sooner. */
const PROCESS_MISS_TTL_MS = 2 * 60 * 1000

async function db() {
  // Imported lazily: detectUserState reaches this module, and most of its
  // callers never need a relay lookup.
  return (await import("@/lib/prisma")).prisma
}

/** The stored set, or null when absent, expired or malformed. Never throws. */
export async function readStoredRelayRanges(now: Date = new Date()): Promise<RelayRangeSet | null> {
  try {
    const prisma = await db()
    const row = await prisma.sportsDataCache.findUnique({ where: { cacheKey: PRIVATE_RELAY_CACHE_KEY } })
    if (!row || row.expiresAt <= now) return null
    return isRelayRangeSet(row.data) ? row.data : null
  } catch {
    return null
  }
}

export async function writeStoredRelayRanges(set: RelayRangeSet): Promise<void> {
  const prisma = await db()
  const expiresAt = new Date(new Date(set.fetchedAt).getTime() + PRIVATE_RELAY_STORE_TTL_MS)
  const data = set as unknown as object
  await prisma.sportsDataCache.upsert({
    where: { cacheKey: PRIVATE_RELAY_CACHE_KEY },
    update: { data, expiresAt },
    create: { cacheKey: PRIVATE_RELAY_CACHE_KEY, data, expiresAt },
  })
  processCache = { set, until: Date.now() + PROCESS_TTL_MS }
}

let processCache: { set: RelayRangeSet | null; until: number } | null = null
let inFlight: Promise<RelayRangeSet | null> | null = null

/** Test seam. */
export function __resetRelayRangeProcessCache(): void {
  processCache = null
  inFlight = null
}

/** The set for this process, read from Postgres at most every 30 minutes. */
export async function getRelayRangeSetNode(): Promise<RelayRangeSet | null> {
  const now = Date.now()
  if (processCache && processCache.until > now) {
    // Honour the stored expiry even between reads.
    const set = processCache.set
    if (!set || Date.parse(set.fetchedAt) + PRIVATE_RELAY_STORE_TTL_MS > now) return set
  }
  if (inFlight) return inFlight
  inFlight = readStoredRelayRanges()
    .then((set) => {
      processCache = { set, until: Date.now() + (set ? PROCESS_TTL_MS : PROCESS_MISS_TTL_MS) }
      return set
    })
    .finally(() => {
      inFlight = null
    })
  return inFlight
}
