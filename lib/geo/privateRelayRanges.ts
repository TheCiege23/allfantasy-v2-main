/**
 * Apple iCloud Private Relay egress ranges → the US state each one belongs to,
 * and the rule for which relay users may be placed by that state.
 *
 * ⚠ WHY THIS EXISTS. Since 2026-09-24 the VPN gate treated Private Relay like a
 * VPN, and Private Relay is ON BY DEFAULT for iCloud+ users in Safari — so a
 * large share of iPhone visitors met the "turn off your VPN" page without ever
 * having installed one. Apple publishes every egress range with the location it
 * stands for (an RFC 8805 geofeed:
 * `prefix,country,region,city,` — e.g. `172.225.46.64/26,US,US-NY,New York,`),
 * and in the default "Maintain general location" setting that region is the
 * person's real state.
 *
 * 🛑 THE CATCH, AND THE OWNER'S RULE FOR IT (2026-09-28). A person can switch
 * Private Relay to "Use country and time zone", after which they may surface in
 * ANY state in their time zone — a Washington user can appear as Oregon or
 * California. Nothing in the feed says which setting produced an address. So:
 *
 *   - Pacific-time states (CA, OR, NV, WA — and ID, see below) stay BLOCKED as
 *     before: anyone placed there could be in Washington, which is full-block.
 *   - Mountain-time states get the free product but NOT paid features: anyone
 *     placed there could be in Idaho or Montana, which are paid-block.
 *   - Everywhere else, the relay user is placed in Apple's state and the normal
 *     state rules apply (Hawaii is its own time zone, so HI stays accurate and
 *     its own paid-block applies through the ordinary rule).
 *
 * ⚠ IDAHO IS COUNTED AS PACIFIC ON PURPOSE. Its panhandle is on Pacific time, so
 * a Washington user on "country and time zone" could in principle surface there.
 * The strict reading costs Idaho relay users nothing they had before this.
 *
 * ⚠ A KNOWN RESIDUAL, recorded rather than hidden: TX, KS, NE, ND and SD each
 * have a sliver on Mountain time and are placed by their MAIN zone (Central). A
 * Mountain-time user surfacing in El Paso would get paid features. That only
 * touches the paid tier (Idaho/Montana are paid-block, not full-block).
 *
 * ⚠ EVERY UNCERTAINTY FAILS TO TODAY'S BEHAVIOUR — BLOCKED. No stored feed, a
 * stale feed that expired, an address the feed does not list, a range the feed
 * lists twice with different states: all of them leave the relay user on the
 * "turn off Private Relay" page, exactly as before this module. Nothing here can
 * let in someone the gate used to refuse, except through a positive, unambiguous
 * placement in a non-Pacific state.
 *
 * Pure and Edge-safe (BigInt, no Node APIs): the middleware and the Node routes
 * share it. The data reaches the middleware through /api/geo/private-relay-ranges
 * and Node code through ./privateRelayStore; the writer is ./privateRelayIngest.
 */

export const PRIVATE_RELAY_RANGE_SET_VERSION = 1

/** A compact, JSON-serialisable set of US egress ranges. */
export interface RelayRangeSet {
  v: typeof PRIVATE_RELAY_RANGE_SET_VERSION
  /** When the feed was fetched from Apple (ISO). */
  fetchedAt: string
  /** State codes, indexed by the third element of each range. */
  states: string[]
  /** IPv4 as `[start, end, stateIndex]`, unsigned 32-bit, sorted by start, non-overlapping. */
  v4: Array<[number, number, number]>
  /** IPv6 as `[start, end, stateIndex]` over the HIGH 64 bits, as 16-digit hex, sorted, non-overlapping. */
  v6: Array<[string, string, number]>
}

export type RelayZone = "pacific" | "mountain" | "other"

/**
 * Pacific-time states, plus Idaho (see the file header). A relay user placed in
 * any of these might be in Washington.
 */
const PACIFIC_STRICT = new Set(["CA", "OR", "NV", "WA", "ID"])

/** States wholly or mainly on Mountain time. A relay user placed here might be in Idaho or Montana. */
const MOUNTAIN = new Set(["AZ", "CO", "MT", "NM", "UT", "WY"])

export function relayZoneForState(state: string): RelayZone {
  const s = state.toUpperCase()
  if (PACIFIC_STRICT.has(s)) return "pacific"
  if (MOUNTAIN.has(s)) return "mountain"
  return "other"
}

/**
 * What to do with a Private Relay client, given the state Apple's feed gives
 * its address (or `null` when the feed does not list it / is unavailable).
 *
 *   placed   — treat the request as coming from `state`; `paidBlocked` keeps
 *              paid features off (Mountain time).
 *   blocked  — the old behaviour: the "turn off Private Relay" page.
 */
export type RelayDecision =
  | { kind: "placed"; state: string; paidBlocked: boolean }
  | { kind: "blocked"; state: string | null }

export function decideRelay(state: string | null): RelayDecision {
  if (!state) return { kind: "blocked", state: null }
  const zone = relayZoneForState(state)
  if (zone === "pacific") return { kind: "blocked", state }
  return { kind: "placed", state, paidBlocked: zone === "mountain" }
}

// ─── Parsing Apple's feed ────────────────────────────────────────────────────

const US_REGION = /^US-([A-Z]{2})$/

function parseIpv4(text: string): number | null {
  const parts = text.split(".")
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null
    const octet = Number(p)
    if (octet > 255) return null
    n = n * 256 + octet
  }
  return n
}

/** A full 128-bit IPv6 address, or null. Accepts `::` compression and an embedded IPv4 tail. */
function parseIpv6(text: string): bigint | null {
  let s = text.trim().toLowerCase()
  const zone = s.indexOf("%")
  if (zone !== -1) s = s.slice(0, zone)
  if (!s.includes(":")) return null

  // An IPv4 tail (`::ffff:1.2.3.4`) becomes two hextets.
  const lastColon = s.lastIndexOf(":")
  const tail = s.slice(lastColon + 1)
  if (tail.includes(".")) {
    const v4 = parseIpv4(tail)
    if (v4 === null) return null
    s = `${s.slice(0, lastColon + 1)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`
  }

  const halves = s.split("::")
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(":") : []
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : []
  const missing = 8 - head.length - rest.length
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...rest]
  if (groups.length !== 8) return null

  let n = 0n
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null
    n = (n << 16n) | BigInt(parseInt(g, 16))
  }
  return n
}

const HIGH_64 = (1n << 64n) - 1n

function hex64(n: bigint): string {
  return n.toString(16).padStart(16, "0")
}

interface RawRange<T> {
  start: T
  end: T
  state: string
}

function parsePrefix(prefix: string): { family: 4; range: [number, number] } | { family: 6; range: [bigint, bigint] } | null {
  const slash = prefix.indexOf("/")
  if (slash === -1) return null
  const addr = prefix.slice(0, slash)
  const len = Number(prefix.slice(slash + 1))
  if (!Number.isInteger(len) || len < 0) return null

  if (addr.includes(":")) {
    if (len > 128) return null
    const ip = parseIpv6(addr)
    if (ip === null) return null
    // Keyed on the high 64 bits: a relay egress block is never narrower than a
    // /64 in practice, and a longer prefix is widened to its /64 — which stays
    // inside Apple's own allocation.
    const hi = ip >> 64n
    if (len >= 64) return { family: 6, range: [hi, hi] }
    const hostBits = BigInt(64 - len)
    const mask = (1n << hostBits) - 1n
    const start = hi & (HIGH_64 ^ mask)
    return { family: 6, range: [start, start | mask] }
  }

  if (len > 32) return null
  const ip = parseIpv4(addr)
  if (ip === null) return null
  const size = 2 ** (32 - len)
  const start = Math.floor(ip / size) * size
  return { family: 4, range: [start, start + size - 1] }
}

/**
 * Sort, merge touching ranges of the same state, and drop any address that the
 * feed gives two different states — an ambiguous address stays unplaced (blocked).
 */
function compact<T extends number | bigint>(ranges: RawRange<T>[], succ: (x: T) => T): RawRange<T>[] {
  ranges.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
  const out: RawRange<T>[] = []
  for (const r of ranges) {
    const prev = out[out.length - 1]
    if (!prev) {
      out.push({ ...r })
      continue
    }
    const overlaps = r.start <= prev.end
    const touches = !overlaps && r.start === succ(prev.end)
    if (prev.state === r.state && (overlaps || touches)) {
      if (r.end > prev.end) prev.end = r.end
      continue
    }
    if (overlaps) {
      // Conflicting states for the same addresses: trust neither.
      prev.state = ""
      if (r.end > prev.end) prev.end = r.end
      continue
    }
    out.push({ ...r })
  }
  return out.filter((r) => r.state !== "")
}

export interface ParseResult {
  set: RelayRangeSet
  /** Lines read, US lines kept, lines that could not be parsed. */
  stats: { lines: number; usLines: number; invalid: number }
}

/** Parse Apple's `egress-ip-ranges.csv`, keeping US rows only. */
export function parseEgressGeofeed(csv: string, fetchedAt: Date): ParseResult {
  const v4: RawRange<number>[] = []
  const v6: RawRange<bigint>[] = []
  let lines = 0
  let usLines = 0
  let invalid = 0

  for (const rawLine of csv.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    lines++
    const [prefix, country, region] = line.split(",")
    if ((country ?? "").trim().toUpperCase() !== "US") continue
    const m = US_REGION.exec((region ?? "").trim().toUpperCase())
    const parsed = parsePrefix((prefix ?? "").trim())
    if (!m || !parsed) {
      invalid++
      continue
    }
    usLines++
    const state = m[1]
    if (parsed.family === 4) v4.push({ start: parsed.range[0], end: parsed.range[1], state })
    else v6.push({ start: parsed.range[0], end: parsed.range[1], state })
  }

  const v4c = compact(v4, (x: number) => x + 1)
  const v6c = compact(v6, (x: bigint) => x + 1n)
  const states = [...new Set([...v4c, ...v6c].map((r) => r.state))].sort()
  const idx = new Map(states.map((s, i) => [s, i]))

  return {
    set: {
      v: PRIVATE_RELAY_RANGE_SET_VERSION,
      fetchedAt: fetchedAt.toISOString(),
      states,
      v4: v4c.map((r) => [r.start, r.end, idx.get(r.state)!]),
      v6: v6c.map((r) => [hex64(r.start), hex64(r.end), idx.get(r.state)!]),
    },
    stats: { lines, usLines, invalid },
  }
}

/** A stored/served value that is not a well-formed set is treated as no data at all. */
export function isRelayRangeSet(value: unknown): value is RelayRangeSet {
  if (!value || typeof value !== "object") return false
  const s = value as Partial<RelayRangeSet>
  return (
    s.v === PRIVATE_RELAY_RANGE_SET_VERSION &&
    typeof s.fetchedAt === "string" &&
    Array.isArray(s.states) &&
    Array.isArray(s.v4) &&
    Array.isArray(s.v6)
  )
}

// ─── Lookup ──────────────────────────────────────────────────────────────────

function search<T>(ranges: Array<[T, T, number]>, key: T, lt: (a: T, b: T) => boolean): number | null {
  let lo = 0
  let hi = ranges.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const [start, end, state] = ranges[mid]
    if (lt(key, start)) hi = mid - 1
    else if (lt(end, key)) lo = mid + 1
    else return state
  }
  return null
}

/** The US state Apple's feed gives this address, or null when it is not listed. */
export function lookupRelayState(set: RelayRangeSet, ip: string): string | null {
  const trimmed = ip.trim()
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(trimmed)
  const v4 = parseIpv4(mapped ? mapped[1] : trimmed)
  if (v4 !== null) {
    const i = search(set.v4, v4, (a, b) => a < b)
    return i === null ? null : set.states[i] ?? null
  }
  const v6 = parseIpv6(trimmed)
  if (v6 === null) return null
  const hi = hex64(v6 >> 64n)
  // Fixed-width lowercase hex compares correctly as strings.
  const i = search(set.v6, hi, (a, b) => a < b)
  return i === null ? null : set.states[i] ?? null
}
