/**
 * Decision OS — Phase 2 Canonical World Assembly: PURE read-only derivations.
 *
 * Every function here is a pure transform over already-loaded canonical rows. No IO, no prisma, no
 * writes, no provider branching. These implement the validated gaps from the Phase 2 audit (§9):
 * remaining-FAAB derivation, current-week derivation, points-against recovery, roster slot projection.
 */
import type {
  FaabFacts,
  RawPerformanceRow,
  RawRosterRow,
  RosterSlotProjection,
} from './facts'

/** Coerce an unknown JSON value into a clean string[] of ids (drops falsy / Sleeper "0" placeholders). */
export function toStringIdArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((v) => (typeof v === 'string' ? v : v == null ? '' : String(v)))
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== '0')
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/**
 * Project a canonical `Roster.playerData` blob (or legacy string[]) into starter/bench/reserve/taxi
 * sections. Bench = players − (starters ∪ reserve ∪ taxi). Provider-neutral: reads the documented
 * canonical shape `{ players, starters, reserve, taxi }` and tolerates the legacy array form.
 */
export function projectRosterSlots(playerData: unknown): RosterSlotProjection & { playerIds: string[] } {
  // Legacy array form: a bare list of player ids, no slotting.
  if (Array.isArray(playerData)) {
    const ids = toStringIdArray(playerData)
    return { playerIds: ids, starters: [], bench: ids, reserve: [], taxi: [] }
  }

  const blob = (playerData ?? {}) as Record<string, unknown>
  const playerIds = toStringIdArray(blob.players)
  const starters = toStringIdArray(blob.starters).filter((id) => playerIds.includes(id))
  const reserve = toStringIdArray(blob.reserve).filter((id) => playerIds.includes(id))
  const taxi = toStringIdArray(blob.taxi).filter((id) => playerIds.includes(id))

  const slotted = new Set<string>([...starters, ...reserve, ...taxi])
  const bench = playerIds.filter((id) => !slotted.has(id))

  return { playerIds, starters, bench, reserve, taxi }
}

/**
 * Look for a persisted "waiver budget used" value across the spots a provider import might place it.
 * Returns null when absent (the common case for current Sleeper imports — see audit §9).
 */
export function readWaiverBudgetUsed(roster: Pick<RawRosterRow, 'settings' | 'playerData'>): number | null {
  const candidates: unknown[] = []
  const settings = (roster.settings ?? {}) as Record<string, unknown>
  candidates.push(settings.waiver_budget_used, settings.waiverBudgetUsed)
  const blob = (roster.playerData ?? {}) as Record<string, unknown>
  candidates.push(blob.waiver_budget_used, blob.waiverBudgetUsed)
  const blobSettings = (blob.settings ?? {}) as Record<string, unknown>
  candidates.push(blobSettings.waiver_budget_used, blobSettings.waiverBudgetUsed)
  for (const c of candidates) {
    const n = readNumber(c)
    if (n != null) return n
  }
  return null
}

/**
 * Derive FAAB facts. Prefers a stored `remaining` (native leagues persist it); otherwise derives
 * `remaining = budget − used` when both are known (the validated imported-league path). Leaves
 * `remaining: null` (honest gap) when neither is possible.
 */
export function deriveFaab(args: {
  storedRemaining: number | null
  budget: number | null
  used: number | null
}): FaabFacts {
  const { storedRemaining, budget, used } = args
  if (storedRemaining != null) {
    return { budget, used, remaining: storedRemaining, remainingDerived: false }
  }
  if (budget != null && used != null) {
    return { budget, used, remaining: Math.max(0, budget - used), remainingDerived: true }
  }
  return { budget, used, remaining: null, remainingDerived: false }
}

/**
 * Derive the league's current week from canonical performance data: the latest week with recorded
 * `TeamPerformance` in the active season. Provider-agnostic and DB-only (no provider state call).
 */
export function deriveCurrentWeek(
  performances: RawPerformanceRow[],
  season: number,
): { currentWeek: number | null; basis: 'team_performance' | 'unavailable' } {
  const weeks = performances
    .filter((p) => p.season === season && typeof p.week === 'number')
    .map((p) => p.week)
  if (weeks.length === 0) return { currentWeek: null, basis: 'unavailable' }
  return { currentWeek: Math.max(...weeks), basis: 'team_performance' }
}

/**
 * Recover a team's points-against. Prefers a positive stored value; otherwise reconstructs it from
 * performances by summing each week's opponent's points. Returns null when neither is available.
 */
export function derivePointsAgainst(args: {
  teamId: string
  storedPointsAgainst: number
  performances: RawPerformanceRow[]
}): { value: number | null; basis: 'stored' | 'derived_from_performances' | 'unavailable' } {
  const { teamId, storedPointsAgainst, performances } = args
  if (storedPointsAgainst > 0) {
    return { value: storedPointsAgainst, basis: 'stored' }
  }

  const pointsByTeamWeek = new Map<string, number>()
  for (const p of performances) {
    pointsByTeamWeek.set(`${p.teamId}:${p.week}`, p.points)
  }

  let sum = 0
  let counted = 0
  for (const p of performances) {
    if (p.teamId !== teamId || !p.opponent) continue
    const oppPoints = pointsByTeamWeek.get(`${p.opponent}:${p.week}`)
    if (typeof oppPoints === 'number') {
      sum += oppPoints
      counted++
    }
  }

  if (counted === 0) return { value: null, basis: 'unavailable' }
  return { value: sum, basis: 'derived_from_performances' }
}
