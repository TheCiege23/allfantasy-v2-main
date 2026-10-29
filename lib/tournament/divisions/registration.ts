/**
 * Join flow rules for the divisions format, as pure functions:
 * registration state, the strict-FIFO waitlist, and deterministic league placement.
 *
 * Placement happens once, when registration closes. It is a seeded shuffle so the
 * same seed always produces the same leagues, and the seed is written to the audit
 * log — "placement is deterministic and logged".
 */

export type RegistrationPhase = 'blueprint' | 'registering' | 'placed' | 'live' | 'complete'
export type JoinState = 'open' | 'almost_full' | 'full' | 'closed' | 'in' | 'waitlisted'

/** "Almost full" once 10% or fewer of the spots are left (at least the last 4). */
export function almostFullThreshold(capacity: number) {
  return Math.max(4, Math.ceil(capacity * 0.1))
}

export function joinState(input: { phase: string; capacity: number; registered: number; myStatus: string | null }): JoinState {
  if (input.myStatus === 'registered') return 'in'
  if (input.myStatus === 'waitlisted') return 'waitlisted'
  if (input.phase !== 'registering') return 'closed'
  const left = input.capacity - input.registered
  if (left <= 0) return 'full'
  if (left <= almostFullThreshold(input.capacity)) return 'almost_full'
  return 'open'
}

export type QueueEntry = { id: string; queuedAt: Date | string }

/** Strict first in, first out. Ties on the timestamp fall back to id so the order is total. */
export function waitlistOrder<T extends QueueEntry>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    const ta = new Date(a.queuedAt).getTime(), tb = new Date(b.queuedAt).getTime()
    return ta !== tb ? ta - tb : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

/** Who moves up when `openSpots` free up: the front of the queue, in order. */
export function promotions<T extends QueueEntry>(entries: T[], openSpots: number): T[] {
  return waitlistOrder(entries).slice(0, Math.max(0, openSpots))
}

export function waitlistPosition<T extends QueueEntry>(entries: T[], id: string): number | null {
  const i = waitlistOrder(entries).findIndex(e => e.id === id)
  return i < 0 ? null : i + 1
}

// ── placement ────────────────────────────────────────────────────────────────

export type PlacementEntrant = {
  id: string
  /** 0 or 1, or null for "Any". Ignored unless the commissioner enabled preferences. */
  preference: 0 | 1 | null
  /** Entrant id of whoever invited them, when known. Used only if grouping is allowed. */
  invitedBy: string | null
}

export type PlacementInput = {
  entrants: PlacementEntrant[]
  conferences: number
  teamsPerConference: number
  allowPreference: boolean
  allowGrouping: boolean
  seed: number
}

export type Placement = {
  /** entrant id → { division, conference } (0-based). */
  assignments: Record<string, { division: 0 | 1; conference: number }>
  leagues: Array<{ division: 0 | 1; conference: number; members: string[] }>
  log: { seed: number; preferenceHonoured: number; preferenceOverflow: number; groupsKept: number; groupsSplit: number }
}

export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

/** Split n as evenly as possible into k buckets. */
export const evenSizes = (n: number, k: number) => Array.from({ length: k }, (_, i) => Math.floor(n / k) + (i < n % k ? 1 : 0))

/**
 * 1. Divisions are balanced (sizes differ by at most one).
 * 2. A preference is honoured only while its division still has room under that balance.
 * 3. With grouping allowed, an inviter and the people they invited stay in one
 *    conference when it has room; otherwise everyone is placed at random.
 * 4. Conference leagues inside a division are balanced too.
 */
export function placeEntrants(input: PlacementInput): Placement {
  const { conferences, teamsPerConference } = input
  const capacity = conferences * teamsPerConference * 2
  if (input.entrants.length > capacity) throw new Error(`Placement has ${input.entrants.length} entrants for ${capacity} spots`)
  if (new Set(input.entrants.map(e => e.id)).size !== input.entrants.length) throw new Error('Duplicate entrant')
  const rand = mulberry32(input.seed)
  const order = shuffle([...input.entrants].sort((a, b) => (a.id < b.id ? -1 : 1)), rand)
  const targets = evenSizes(order.length, 2) as [number, number]
  // Randomise which division takes the odd extra so neither side is favoured.
  if (targets[0] !== targets[1] && rand() < 0.5) targets.reverse()

  // ── groups: inviter + invitees travel together when grouping is allowed
  const byId = new Map(order.map(e => [e.id, e]))
  const groupOf = new Map<string, string>()
  if (input.allowGrouping) {
    const root = (id: string): string => {
      let cur = id
      const seen = new Set<string>()
      while (byId.get(cur)?.invitedBy && byId.has(byId.get(cur)!.invitedBy!) && !seen.has(cur)) { seen.add(cur); cur = byId.get(cur)!.invitedBy! }
      return cur
    }
    for (const e of order) groupOf.set(e.id, root(e.id))
  } else {
    for (const e of order) groupOf.set(e.id, e.id)
  }
  const groups = new Map<string, PlacementEntrant[]>()
  for (const e of order) { const g = groupOf.get(e.id)!; groups.set(g, [...(groups.get(g) ?? []), e]) }

  // ── divisions
  const division = new Map<string, 0 | 1>()
  const counts = [0, 0]
  let honoured = 0, overflow = 0
  const room = (d: 0 | 1, n = 1) => counts[d]! + n <= targets[d]!
  for (const members of groups.values()) {
    const prefs = input.allowPreference ? members.map(m => m.preference).filter((p): p is 0 | 1 => p !== null) : []
    const wanted: 0 | 1 | null = prefs.length ? (prefs.filter(p => p === 0).length >= prefs.filter(p => p === 1).length ? 0 : 1) : null
    let d: 0 | 1 | null = null
    if (wanted !== null && room(wanted, members.length)) d = wanted
    else if (room(0, members.length) && room(1, members.length)) d = counts[0]! <= counts[1]! ? 0 : 1
    else if (room(0, members.length)) d = 0
    else if (room(1, members.length)) d = 1
    if (d !== null) {
      for (const m of members) { division.set(m.id, d); counts[d]!++ }
      if (wanted !== null) { if (d === wanted) honoured += prefs.length; else overflow += prefs.length }
      continue
    }
    // The group does not fit whole: place members one by one.
    for (const m of members) {
      const want = input.allowPreference ? m.preference : null
      const dd: 0 | 1 = want !== null && room(want) ? want : room(0) && (!room(1) || counts[0]! <= counts[1]!) ? 0 : 1
      division.set(m.id, dd); counts[dd]!++
      if (want !== null) { if (dd === want) honoured++; else overflow++ }
    }
  }

  // ── conferences inside each division
  const assignments: Placement['assignments'] = {}
  const leagues: Placement['leagues'] = []
  let groupsKept = 0, groupsSplit = 0
  for (const d of [0, 1] as const) {
    const inDivision = order.filter(e => division.get(e.id) === d)
    const sizes = evenSizes(inDivision.length, conferences)
    const members: string[][] = Array.from({ length: conferences }, () => [])
    const divGroups = new Map<string, string[]>()
    for (const e of inDivision) { const g = groupOf.get(e.id)!; divGroups.set(g, [...(divGroups.get(g) ?? []), e.id]) }
    // Largest groups first so they find a conference with room.
    const sorted = [...divGroups.values()].sort((a, b) => b.length - a.length)
    for (const group of sorted) {
      const fit = members.map((m, i) => ({ i, left: sizes[i]! - m.length })).filter(x => x.left >= group.length).sort((a, b) => b.left - a.left || a.i - b.i)[0]
      if (fit) {
        members[fit.i]!.push(...group)
        if (group.length > 1) groupsKept++
      } else {
        if (group.length > 1) groupsSplit++
        for (const id of group) {
          const best = members.map((m, i) => ({ i, left: sizes[i]! - m.length })).sort((a, b) => b.left - a.left || a.i - b.i)[0]!
          members[best.i]!.push(id)
        }
      }
    }
    members.forEach((ids, conference) => {
      leagues.push({ division: d, conference, members: ids })
      for (const id of ids) assignments[id] = { division: d, conference }
    })
  }
  return { assignments, leagues, log: { seed: input.seed, preferenceHonoured: honoured, preferenceOverflow: overflow, groupsKept, groupsSplit } }
}
