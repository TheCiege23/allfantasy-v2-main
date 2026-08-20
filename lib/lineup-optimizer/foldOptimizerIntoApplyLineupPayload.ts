/**
 * Pure roster-folding helper for the future Apply Lineup flow.
 *
 * NOTE: This module is intentionally side-effect-free. It does NOT call the
 * network, does NOT mutate any state, and does NOT enable the disabled
 * "Apply lineup (coming soon)" button. It exists so that a future
 * confirmation modal can preview an exact, server-shape-compatible payload
 * for `POST /api/leagues/[leagueId]/roster/ai-apply-lineup` without
 * inventing players, dropping IR/TAXI/DEVY, or overriding locks.
 *
 * Input contracts:
 *   - currentPersistedRoster: the raw `roster` value returned by
 *     `/api/league/roster?leagueId=…` (which is `Roster.playerData` from
 *     Prisma). Newer shape has `lineup_sections: { starters, bench, ir,
 *     taxi, devy }`; older shape only has `players[]` with positional
 *     hints. We support both — when `lineup_sections` is missing we fall
 *     back to `players[]` and put everyone on bench.
 *   - optimizerStarters: the `result.starters` array from
 *     `/api/lineup/optimize` (slotCode + playerId + playerName +
 *     projectedPoints + selectedPosition).
 *   - lockedPlayerIds: the `lineupLock.lockedPlayerIds` from
 *     `/api/league/roster`. A locked player may stay in starters or stay
 *     on bench/IR/taxi/devy, but cannot move sections.
 *   - week: optional explicit week; otherwise omitted.
 *
 * Output:
 *   - payload: the exact body shape that `/ai-apply-lineup` accepts
 *     (`{ week?, roster: { starters, bench, ir, taxi, devy } }`) — full
 *     player objects in each section. `null` when not safe to apply.
 *   - diff: human-readable preview for a future confirmation modal.
 *   - safeToApply: false if any safety rule was violated.
 *   - blockingReasons: machine-friendly reasons; mirrors the strings the
 *     server may also reject with.
 */

export type RosterSectionKey = 'starters' | 'bench' | 'ir' | 'taxi' | 'devy'

/** Server `lineup_sections` row — must match `buildPersistedRosterDataFromRosterState`. */
export interface PersistedRosterPlayer {
  id: string
  name: string
  team: string
  position: string
  opponent: string
  gameTime: string
  projection: number
  actual: number | null
  status: string
}

export interface OptimizerStarterRow {
  slotId: string
  slotCode: string
  slotLabel?: string
  playerId: string
  playerName: string
  projectedPoints: number
  selectedPosition: string
}

export interface OptimizerResultLike {
  starters: OptimizerStarterRow[]
  unfilledSlots?: Array<{ slotId: string; slotCode: string; slotLabel?: string }>
}

export interface FoldRosterInput {
  currentPersistedRoster: unknown
  optimizerResult: OptimizerResultLike | null | undefined
  lockedPlayerIds?: ReadonlyArray<string>
  week?: number
}

export interface RosterFoldDiff {
  movedToStarters: Array<{ id: string; name: string; fromSection: RosterSectionKey; slotCode: string }>
  movedToBench: Array<{ id: string; name: string; fromSection: RosterSectionKey }>
  unchangedStarters: Array<{ id: string; name: string; slotCode: string }>
  blockedLockedPlayers: Array<{ id: string; name: string; reason: string }>
  missingFromRoster: Array<{ id: string; name: string; slotCode: string }>
  preserved: { ir: string[]; taxi: string[]; devy: string[] }
}

export type RosterFoldBlockingReason =
  | 'no_optimizer_result'
  | 'no_persisted_roster'
  | 'unfilled_slots'
  | 'starter_not_on_roster'
  | 'locked_player_section_change'
  | 'duplicate_player'
  | 'dropped_player'
  | 'empty_starters'

export interface RosterFoldResult {
  payload:
    | {
        week?: number
        roster: {
          starters: PersistedRosterPlayer[]
          bench: PersistedRosterPlayer[]
          ir: PersistedRosterPlayer[]
          taxi: PersistedRosterPlayer[]
          devy: PersistedRosterPlayer[]
        }
      }
    | null
  diff: RosterFoldDiff
  safeToApply: boolean
  blockingReasons: RosterFoldBlockingReason[]
}

/* --------------------------------- internals --------------------------------- */

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function coercePlayer(raw: unknown): PersistedRosterPlayer | null {
  if (typeof raw === 'string') {
    const id = raw.trim()
    if (!id) return null
    return {
      id,
      name: id,
      team: '—',
      position: 'UTIL',
      opponent: '—',
      gameTime: '—',
      projection: 0,
      actual: null,
      status: 'healthy',
    }
  }
  const obj = asRecord(raw)
  if (!obj) return null
  const idSrc = obj.id ?? obj.player_id
  const id = typeof idSrc === 'string' ? idSrc.trim() : ''
  if (!id) return null
  return {
    id,
    name: String(obj.name ?? obj.full_name ?? id),
    team: String(obj.team ?? obj.team_abbreviation ?? '—'),
    position: String(obj.position ?? 'UTIL').toUpperCase(),
    opponent: String(obj.opponent ?? '—'),
    gameTime: String(obj.gameTime ?? obj.game_time ?? '—'),
    projection: Number(obj.projection ?? obj.projectedPoints ?? 0) || 0,
    actual: obj.actual == null ? null : Number(obj.actual),
    status: String(obj.status ?? obj.injury_status ?? 'healthy').toLowerCase(),
  }
}

interface ParsedSections {
  starters: PersistedRosterPlayer[]
  bench: PersistedRosterPlayer[]
  ir: PersistedRosterPlayer[]
  taxi: PersistedRosterPlayer[]
  devy: PersistedRosterPlayer[]
}

function parsePersistedSections(currentPersistedRoster: unknown): ParsedSections | null {
  const root = asRecord(currentPersistedRoster)
  if (!root) return null

  const ls = asRecord(root.lineup_sections)
  if (ls) {
    return {
      starters: asArray(ls.starters).map(coercePlayer).filter((p): p is PersistedRosterPlayer => Boolean(p)),
      bench: asArray(ls.bench).map(coercePlayer).filter((p): p is PersistedRosterPlayer => Boolean(p)),
      ir: asArray(ls.ir).map(coercePlayer).filter((p): p is PersistedRosterPlayer => Boolean(p)),
      taxi: asArray(ls.taxi).map(coercePlayer).filter((p): p is PersistedRosterPlayer => Boolean(p)),
      devy: asArray(ls.devy).map(coercePlayer).filter((p): p is PersistedRosterPlayer => Boolean(p)),
    }
  }

  // Fallback: legacy/unstructured shape — derive sections from id arrays.
  const allPlayers = asArray(root.players)
    .map(coercePlayer)
    .filter((p): p is PersistedRosterPlayer => Boolean(p))
  if (allPlayers.length === 0) return null

  const byId = new Map(allPlayers.map((p) => [p.id, p]))
  const startersIds = asArray(root.starters)
    .map((x) => (typeof x === 'string' ? x : null))
    .filter((x): x is string => Boolean(x))
  const irIds = asArray(root.reserve)
    .map((x) => (typeof x === 'string' ? x : null))
    .filter((x): x is string => Boolean(x))
  const taxiIds = asArray(root.taxi)
    .map((x) => (typeof x === 'string' ? x : null))
    .filter((x): x is string => Boolean(x))
  const devyIds = asArray(root.devy)
    .map((x) => (typeof x === 'string' ? x : null))
    .filter((x): x is string => Boolean(x))

  const used = new Set<string>([...startersIds, ...irIds, ...taxiIds, ...devyIds])
  const benchPlayers = allPlayers.filter((p) => !used.has(p.id))

  const pickByIds = (ids: string[]) =>
    ids.map((id) => byId.get(id)).filter((p): p is PersistedRosterPlayer => Boolean(p))

  return {
    starters: pickByIds(startersIds),
    bench: benchPlayers,
    ir: pickByIds(irIds),
    taxi: pickByIds(taxiIds),
    devy: pickByIds(devyIds),
  }
}

function findSection(
  sections: ParsedSections,
  playerId: string,
): RosterSectionKey | null {
  const keys: RosterSectionKey[] = ['starters', 'bench', 'ir', 'taxi', 'devy']
  for (const k of keys) {
    if (sections[k].some((p) => p.id === playerId)) return k
  }
  return null
}

/* ----------------------------------- API ------------------------------------ */

export function foldOptimizerIntoApplyLineupPayload(input: FoldRosterInput): RosterFoldResult {
  const blockingReasons: RosterFoldBlockingReason[] = []
  const diff: RosterFoldDiff = {
    movedToStarters: [],
    movedToBench: [],
    unchangedStarters: [],
    blockedLockedPlayers: [],
    missingFromRoster: [],
    preserved: { ir: [], taxi: [], devy: [] },
  }

  const sections = parsePersistedSections(input.currentPersistedRoster)
  if (!sections) {
    blockingReasons.push('no_persisted_roster')
    return { payload: null, diff, safeToApply: false, blockingReasons }
  }

  diff.preserved.ir = sections.ir.map((p) => p.id)
  diff.preserved.taxi = sections.taxi.map((p) => p.id)
  diff.preserved.devy = sections.devy.map((p) => p.id)

  const opt = input.optimizerResult
  if (!opt || !Array.isArray(opt.starters)) {
    blockingReasons.push('no_optimizer_result')
    return { payload: null, diff, safeToApply: false, blockingReasons }
  }

  if (opt.starters.length === 0) {
    blockingReasons.push('empty_starters')
    return { payload: null, diff, safeToApply: false, blockingReasons }
  }

  if (Array.isArray(opt.unfilledSlots) && opt.unfilledSlots.length > 0) {
    blockingReasons.push('unfilled_slots')
  }

  const lockedSet = new Set<string>(input.lockedPlayerIds ?? [])

  // Build a quick lookup over every player currently on the roster (any section).
  const allCurrent: PersistedRosterPlayer[] = [
    ...sections.starters,
    ...sections.bench,
    ...sections.ir,
    ...sections.taxi,
    ...sections.devy,
  ]
  const currentById = new Map<string, PersistedRosterPlayer>()
  for (const p of allCurrent) {
    if (!currentById.has(p.id)) currentById.set(p.id, p)
  }
  const currentStarterIds = new Set(sections.starters.map((p) => p.id))

  // Build the new starters list in optimizer order. Each entry must map back
  // to a player already on the persisted roster — never invent.
  const newStarters: PersistedRosterPlayer[] = []
  const seenStarterIds = new Set<string>()
  for (const row of opt.starters) {
    const id = typeof row?.playerId === 'string' ? row.playerId.trim() : ''
    const existing = id ? currentById.get(id) : undefined
    if (!existing) {
      diff.missingFromRoster.push({
        id,
        name: row?.playerName ?? id ?? '(unknown)',
        slotCode: row?.slotCode ?? '—',
      })
      blockingReasons.push('starter_not_on_roster')
      continue
    }
    if (seenStarterIds.has(id)) {
      blockingReasons.push('duplicate_player')
      continue
    }
    const fromSection = findSection(sections, id) ?? 'bench'
    if (lockedSet.has(id) && fromSection !== 'starters') {
      diff.blockedLockedPlayers.push({
        id,
        name: existing.name,
        reason: `Locked player cannot move from ${fromSection} into starters.`,
      })
      blockingReasons.push('locked_player_section_change')
      continue
    }
    seenStarterIds.add(id)
    newStarters.push(existing)
    if (currentStarterIds.has(id)) {
      diff.unchangedStarters.push({ id, name: existing.name, slotCode: row.slotCode })
    } else {
      diff.movedToStarters.push({ id, name: existing.name, fromSection, slotCode: row.slotCode })
    }
  }

  // Locked starters that the optimizer dropped from the lineup must stay put.
  for (const cur of sections.starters) {
    if (lockedSet.has(cur.id) && !seenStarterIds.has(cur.id)) {
      diff.blockedLockedPlayers.push({
        id: cur.id,
        name: cur.name,
        reason: 'Locked starter cannot be benched.',
      })
      blockingReasons.push('locked_player_section_change')
    }
  }

  // Bench = every roster player not in starters/IR/taxi/devy.
  const reservedIds = new Set<string>([
    ...newStarters.map((p) => p.id),
    ...sections.ir.map((p) => p.id),
    ...sections.taxi.map((p) => p.id),
    ...sections.devy.map((p) => p.id),
  ])
  const newBench: PersistedRosterPlayer[] = []
  const seenBench = new Set<string>()
  for (const p of allCurrent) {
    if (reservedIds.has(p.id)) continue
    if (seenBench.has(p.id)) continue
    seenBench.add(p.id)
    newBench.push(p)
    const fromSection = findSection(sections, p.id) ?? 'bench'
    if (fromSection !== 'bench') {
      diff.movedToBench.push({ id: p.id, name: p.name, fromSection })
    }
  }

  // Drop / duplicate guards across the whole proposed payload.
  const proposedIds: string[] = [
    ...newStarters.map((p) => p.id),
    ...newBench.map((p) => p.id),
    ...sections.ir.map((p) => p.id),
    ...sections.taxi.map((p) => p.id),
    ...sections.devy.map((p) => p.id),
  ]
  if (new Set(proposedIds).size !== proposedIds.length) {
    blockingReasons.push('duplicate_player')
  }
  const currentIds = new Set(allCurrent.map((p) => p.id))
  if (currentIds.size !== new Set(proposedIds).size) {
    blockingReasons.push('dropped_player')
  } else {
    for (const id of currentIds) {
      if (!proposedIds.includes(id)) {
        blockingReasons.push('dropped_player')
        break
      }
    }
  }

  const dedupedReasons: RosterFoldBlockingReason[] = Array.from(new Set(blockingReasons))
  const safeToApply = dedupedReasons.length === 0

  return {
    payload: safeToApply
      ? {
          ...(typeof input.week === 'number' && Number.isFinite(input.week) && input.week > 0
            ? { week: Math.floor(input.week) }
            : {}),
          roster: {
            starters: newStarters,
            bench: newBench,
            ir: sections.ir,
            taxi: sections.taxi,
            devy: sections.devy,
          },
        }
      : null,
    diff,
    safeToApply,
    blockingReasons: dedupedReasons,
  }
}
