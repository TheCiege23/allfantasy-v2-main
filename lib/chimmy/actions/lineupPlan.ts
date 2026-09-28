/**
 * The pure half of "set my lineup": given the roster as stored and the moves, the exact next
 * `playerData` — or the reason there is none. No IO, so every rule here is unit-tested directly.
 *
 * ── 🛑 A SURGICAL WRITE, NOT A REBUILD ─────────────────────────────────────────────────────────
 * `buildPersistedRosterDataFromRosterState` (the Roster tab's save path) regenerates every section
 * row from a whitelist of fields and recomputes `players` from the sections. Handed a roster whose
 * sections do not list every player, that silently DROPS players. So this does not rebuild: it moves
 * the raw row objects between `lineup_sections.starters` and `.bench`, rewrites the flat `starters`
 * id list to match, and leaves every other byte of `playerData` alone.
 *
 * ⚠ AND IT REFUSES A ROSTER WHOSE SECTIONS AND `players` DISAGREE. A move built on a partial view of
 * the roster is the one this code cannot make safe, so it does not try.
 *
 * ── SEATING ────────────────────────────────────────────────────────────────────────────────────
 * Stored starters are index-aligned to the league's expanded slots (QB, RB1, RB2, …, FLEX) — the
 * convention `buildLineupListsFromPlayerData` reads. Players who stay keep their slot; incoming
 * players fill the freed slots they are eligible for. When that does not work (a WR replacing a
 * RB in the RB slot while the FLEX holds a RB), every starter is re-seated by bipartite matching,
 * so "start Nacua, bench Pollard" still lands if ANY legal arrangement exists.
 */

export type PlanSlot = { index: number; label: string; allowedPositions: string[] }

export type PlanPlayer = { playerId: string; name: string; position: string | null }

export type PlanMove = { playerId: string; to: 'starters' | 'bench' }

export type LineupPlan =
  | {
      ok: true
      nextPlayerData: Record<string, unknown>
      /** Incoming starters with the slot label each lands in. */
      moveIn: Array<{ playerId: string; slot: string | null }>
      moveOut: string[]
      /** Starting slots left empty after the move. */
      emptySlots: number
      beforeStarterIds: string[]
      afterStarterIds: string[]
    }
  | { ok: false; reason: string }

const SECTIONS = ['starters', 'bench', 'ir', 'taxi', 'devy'] as const
type Section = (typeof SECTIONS)[number]

function idOf(item: unknown): string | null {
  if (typeof item === 'string') return item.trim() || null
  if (item && typeof item === 'object') {
    const o = item as Record<string, unknown>
    const id = o.id ?? o.player_id
    if (typeof id === 'string' && id.trim()) return id.trim()
    if (typeof id === 'number') return String(id)
  }
  return null
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

/** Position spellings normalised the way the lineup validator normalises them. */
export function normPos(p: string | null | undefined): string {
  const pos = String(p ?? '').trim().toUpperCase()
  if (pos === 'GK') return 'GKP'
  if (pos === 'EDGE') return 'DE'
  if (pos === 'OLB' || pos === 'ILB' || pos === 'MLB') return 'LB'
  if (pos === 'SS' || pos === 'FS') return 'S'
  if (pos === 'NT') return 'DT'
  return pos
}

/** A player listed at several positions ("PG/SG", "2B,SS") is eligible wherever any of them is. */
export function eligible(slot: PlanSlot, position: string | null): boolean {
  const positions = String(position ?? '')
    .split(/[\/,]+/)
    .map(normPos)
    .filter((p) => p && p !== 'UTIL')
  if (positions.length === 0) return false
  const allowed = slot.allowedPositions.map(normPos)
  return allowed.includes('*') || positions.some((p) => allowed.includes(p))
}

/**
 * Kuhn's augmenting-path matching: players → slots. Returns slotIndex per player, or null.
 *
 * Tuned to MOVE AS FEW PEOPLE AS POSSIBLE, because every seat it changes is a change the user did
 * not ask for: each player tries his own slot first (`home`), then any FREE slot, then bumping an
 * occupant who can step straight into a free slot, and only then a full augmenting chain.
 */
function match(
  players: string[],
  slots: PlanSlot[],
  can: (playerId: string, slot: PlanSlot) => boolean,
  preset: Map<number, string> = new Map(),
  home: Map<string, number> = new Map(),
): Map<string, number> | null {
  const slotOwner = new Map<number, string>(preset)
  const assign = new Map<string, number>()
  for (const [slotIdx, pid] of preset) assign.set(pid, slotIdx)

  const orderFor = (pid: string): PlanSlot[] => {
    const h = home.get(pid)
    return h === undefined ? slots : [...slots.filter((s) => s.index === h), ...slots.filter((s) => s.index !== h)]
  }
  const take = (pid: string, slotIdx: number) => {
    slotOwner.set(slotIdx, pid)
    assign.set(pid, slotIdx)
  }
  const freeSlotFor = (pid: string, seen: Set<number>): PlanSlot | undefined =>
    orderFor(pid).find((s) => !seen.has(s.index) && !slotOwner.has(s.index) && can(pid, s))

  const tryPlace = (pid: string, seen: Set<number>): boolean => {
    const free = freeSlotFor(pid, seen)
    if (free) {
      seen.add(free.index)
      take(pid, free.index)
      return true
    }
    const eligibleTaken = orderFor(pid).filter((s) => !seen.has(s.index) && can(pid, s) && !preset.has(s.index))
    /* One hop: an occupant who can step straight into a free slot. */
    for (const slot of eligibleTaken) {
      const owner = slotOwner.get(slot.index)!
      const next = freeSlotFor(owner, new Set([...seen, slot.index]))
      if (next) {
        seen.add(slot.index)
        seen.add(next.index)
        take(owner, next.index)
        take(pid, slot.index)
        return true
      }
    }
    /* Full augmenting chain. */
    for (const slot of eligibleTaken) {
      if (seen.has(slot.index)) continue
      seen.add(slot.index)
      const owner = slotOwner.get(slot.index)!
      if (tryPlace(owner, seen)) {
        take(pid, slot.index)
        return true
      }
    }
    return false
  }
  for (const pid of players) {
    if (assign.has(pid)) continue
    if (!tryPlace(pid, new Set())) return null
  }
  return assign
}

export function planLineupMoves(args: {
  playerData: unknown
  rosterPlayerIds: string[]
  slots: PlanSlot[]
  players: Map<string, PlanPlayer>
  moves: PlanMove[]
  nowIso?: string
}): LineupPlan {
  const pd =
    args.playerData && typeof args.playerData === 'object' && !Array.isArray(args.playerData)
      ? (args.playerData as Record<string, unknown>)
      : null
  const rawSections =
    pd?.lineup_sections && typeof pd.lineup_sections === 'object' && !Array.isArray(pd.lineup_sections)
      ? (pd.lineup_sections as Record<string, unknown>)
      : null
  if (!pd || !rawSections) {
    return { ok: false, reason: 'This team has no saved lineup to edit yet — set it once in the Roster tab first.' }
  }

  const where = new Map<string, Section>()
  for (const section of SECTIONS) {
    for (const item of asArray(rawSections[section])) {
      const id = idOf(item)
      if (id && !where.has(id)) where.set(id, section)
    }
  }
  const sectionIds = new Set(where.keys())
  const rosterIds = new Set(args.rosterPlayerIds.map(String))
  const sameSet = sectionIds.size === rosterIds.size && [...rosterIds].every((id) => sectionIds.has(id))
  if (!sameSet) {
    return {
      ok: false,
      reason: "This team's saved lineup doesn't list every player on the roster, so it can't be edited safely from chat — open the Roster tab and save it once there.",
    }
  }

  const rawStarters = asArray(rawSections.starters)
  const rawBench = asArray(rawSections.bench)
  const starterIds = rawStarters.map(idOf).filter((x): x is string => Boolean(x))
  if (starterIds.length > args.slots.length) {
    return {
      ok: false,
      reason: `Your saved lineup has ${starterIds.length} starters but this league has ${args.slots.length} starting slots — fix it in the Roster tab first.`,
    }
  }

  const name = (id: string) => args.players.get(id)?.name ?? id
  const moveIn: string[] = []
  const moveOut: string[] = []
  const seen = new Set<string>()
  for (const m of args.moves) {
    if (seen.has(m.playerId)) return { ok: false, reason: `${name(m.playerId)} is named twice.` }
    seen.add(m.playerId)
    const at = where.get(m.playerId)
    if (!at) return { ok: false, reason: `${name(m.playerId)} is not on your roster.` }
    if (m.to === 'starters') {
      if (at === 'starters') continue
      if (at !== 'bench') {
        return { ok: false, reason: `${name(m.playerId)} is on your ${at.toUpperCase()} list — move him to the bench in the Roster tab before he can start.` }
      }
      moveIn.push(m.playerId)
    } else {
      if (at === 'bench') continue
      if (at !== 'starters') return { ok: false, reason: `${name(m.playerId)} is on your ${at.toUpperCase()} list, not in the lineup.` }
      moveOut.push(m.playerId)
    }
  }
  if (moveIn.length === 0 && moveOut.length === 0) {
    return { ok: false, reason: 'Your lineup is already set that way — nothing to change.' }
  }

  const outSet = new Set(moveOut)
  const staying = starterIds.filter((id) => !outSet.has(id))
  const target = [...staying, ...moveIn]
  if (target.length > args.slots.length) {
    return {
      ok: false,
      reason: `That would start ${target.length} players and this league has ${args.slots.length} starting slots — bench someone too.`,
    }
  }
  for (const id of moveIn) {
    if (!normPos(args.players.get(id)?.position) || normPos(args.players.get(id)?.position) === 'UTIL') {
      return { ok: false, reason: `I can't confirm ${name(id)}'s position, so I can't seat him safely — set this one in the Roster tab.` }
    }
  }

  const originalIndex = new Map(starterIds.map((id, i) => [id, i]))
  const pos = (id: string) => args.players.get(id)?.position ?? null

  /* 1. Stable: stayers keep their slot; incoming players fill what was freed. */
  const preset = new Map<number, string>()
  for (const id of staying) preset.set(originalIndex.get(id)!, id)
  let assignment = match(moveIn, args.slots, (id, slot) => !preset.has(slot.index) && eligible(slot, pos(id)), preset)

  /* 2. Re-seat everyone. A stayer with no known position may only keep the slot he already had. */
  if (!assignment) {
    const can = (id: string, slot: PlanSlot) =>
      normPos(pos(id)) && normPos(pos(id)) !== 'UTIL' ? eligible(slot, pos(id)) : originalIndex.get(id) === slot.index
    const firstK = args.slots.slice(0, target.length)
    assignment = match(target, firstK, can, new Map(), originalIndex) ?? match(target, args.slots, can, new Map(), originalIndex)
  }
  if (!assignment) {
    const stuck = moveIn.filter((id) => !args.slots.some((s) => eligible(s, pos(id))))
    return {
      ok: false,
      reason: stuck.length
        ? `No starting slot in this league takes ${stuck.map((id) => `${name(id)} (${pos(id) ?? '?'})`).join(', ')}.`
        : `There's no legal way to fit ${moveIn.map(name).join(', ')} into your starting slots with that change — try benching a different player.`,
    }
  }

  const bySlot = [...assignment.entries()].sort((a, b) => a[1] - b[1])
  const rowFor = new Map<string, unknown>()
  for (const item of [...rawStarters, ...rawBench]) {
    const id = idOf(item)
    if (id && !rowFor.has(id)) rowFor.set(id, item)
  }
  const inSet = new Set(moveIn)
  const nextStarters = bySlot.map(([id]) => rowFor.get(id))
  const nextBench = [...rawBench.filter((item) => !inSet.has(idOf(item) ?? '')), ...moveOut.map((id) => rowFor.get(id))]
  const afterStarterIds = bySlot.map(([id]) => id)

  const nextPlayerData: Record<string, unknown> = {
    ...pd,
    lineup_sections: { ...rawSections, starters: nextStarters, bench: nextBench },
    starters: afterStarterIds,
    lineup_updated_at: args.nowIso ?? new Date().toISOString(),
  }

  const slotLabel = new Map(args.slots.map((s) => [s.index, s.label]))
  return {
    ok: true,
    nextPlayerData,
    moveIn: moveIn.map((id) => ({ playerId: id, slot: slotLabel.get(assignment!.get(id)!) ?? null })),
    moveOut,
    emptySlots: Math.max(0, args.slots.length - afterStarterIds.length),
    beforeStarterIds: starterIds,
    afterStarterIds,
  }
}
