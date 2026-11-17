import { z } from 'zod'
import type { SeasonBlueprint } from './seasonBlueprint'

const scoreSchema = z.object({
  stageId: z.string().min(1), entrantId: z.string().min(1), leagueId: z.string().min(1),
  period: z.number().int().min(1), revision: z.number().int().min(1),
  status: z.enum(['provisional', 'final']), points: z.number().finite().min(-1_000_000).max(1_000_000),
  wins: z.union([z.literal(0), z.literal(0.5), z.literal(1)]), played: z.boolean().optional(),
})
export type TournamentWeeklyResult = z.infer<typeof scoreSchema>
export type TournamentStageEntrant = {
  id: string
  displayName: string
  leagueId: string
  /** Seed at the start of this stage, not last week's provisional rank. */
  previousSeed: number | null
}
type Tiebreaker = SeasonBlueprint['tiebreakers'][number]
const UNITS = 10_000
function units(value: number) {
  const result = Math.round(value * UNITS)
  if (Math.abs(value * UNITS - result) > 0.00001) throw new Error('Fantasy points support at most four decimal places.')
  return result
}

/**
 * Computes one stage from an immutable entrant set and explicit elapsed scoring periods.
 * No missing score is inferred to be zero. Only the newest revision for each team/period counts.
 * Results from other stages/periods are ignored, so a redraft always starts fresh.
 */
export function computeSeasonTournamentStandings(input: {
  stageId: string
  entrants: TournamentStageEntrant[]
  periods: number[]
  results: TournamentWeeklyResult[]
  tiebreakers: Tiebreaker[]
  previousWeekRanks?: Record<string, number>
  compareWinRate?: boolean
  finalTieOrder?: readonly string[]
}) {
  if (!input.stageId || !input.entrants.length) throw new Error('A stage and entrants are required.')
  const entrants = new Map(input.entrants.map(e => [e.id, e]))
  if (entrants.size !== input.entrants.length || input.entrants.some(e => !e.id || !e.leagueId)) throw new Error('Entrants must be distinct and assigned to a league.')
  const finalTieOrder = new Map(input.finalTieOrder?.map((id, index) => [id, index]))
  if (input.finalTieOrder && (input.finalTieOrder.length !== entrants.size || finalTieOrder.size !== entrants.size || [...entrants.keys()].some(id => !finalTieOrder.has(id)))) {
    throw new Error('The final tiebreak order must contain each stage entrant exactly once.')
  }
  const previousSeeds = input.entrants.flatMap(e => e.previousSeed == null ? [] : [e.previousSeed])
  if (previousSeeds.some(seed => !Number.isInteger(seed) || seed < 1) || new Set(previousSeeds).size !== previousSeeds.length) throw new Error('Previous seeds must be distinct positive integers.')
  const periods = new Set(input.periods)
  if (!periods.size || periods.size !== input.periods.length || input.periods.some(p => !Number.isInteger(p) || p < 1)) throw new Error('Distinct scoring periods are required.')
  if (new Set(input.tiebreakers).size !== input.tiebreakers.length || input.tiebreakers.some(t => !['best_week', 'wins', 'previous_seed'].includes(t))) throw new Error('Invalid tiebreakers.')

  const latest = new Map<string, TournamentWeeklyResult>()
  const seenVersions = new Map<string, string>()
  for (const raw of input.results) {
    if (raw.stageId !== input.stageId || !periods.has(raw.period)) continue
    const row = scoreSchema.parse(raw)
    const entrant = entrants.get(row.entrantId)
    if (!entrant || entrant.leagueId !== row.leagueId) throw new Error('Score does not match this stage entrant and league.')
    const key = JSON.stringify([row.entrantId, row.period])
    const versionKey = JSON.stringify([row.entrantId, row.period, row.revision])
    const payload = JSON.stringify([units(row.points), row.wins, row.status, row.leagueId, row.played ?? true])
    if (seenVersions.has(versionKey) && seenVersions.get(versionKey) !== payload) throw new Error('Conflicting score payloads share a revision.')
    seenVersions.set(versionKey, payload)
    if (!latest.has(key) || latest.get(key)!.revision < row.revision) latest.set(key, row)
  }

  const compare = (a: { id: string; total: number | null; best: number | null; wins: number; gamesPlayed: number; previousSeed: number | null }, b: typeof a) => {
    const difference = (b.total ?? -Infinity) - (a.total ?? -Infinity)
    if (a.total !== b.total) return difference
    for (const t of input.tiebreakers) {
      const value = t === 'best_week' ? (b.best ?? -Infinity) - (a.best ?? -Infinity)
        : t === 'wins' ? (input.compareWinRate ? b.wins * Math.max(1, a.gamesPlayed) - a.wins * Math.max(1, b.gamesPlayed) : b.wins - a.wins)
        : (a.previousSeed ?? Infinity) - (b.previousSeed ?? Infinity)
      if (value && !Number.isNaN(value)) return value
    }
    return input.finalTieOrder ? finalTieOrder.get(a.id)! - finalTieOrder.get(b.id)! : 0
  }
  const rows = input.entrants.map(entrant => {
    const scores = [...periods].map(period => ({ period, row: latest.get(JSON.stringify([entrant.id, period])) }))
    const known = scores.flatMap(s => s.row ? [s.row] : [])
    const total = known.length ? known.reduce((sum, s) => sum + units(s.points), 0) : null
    const best = known.length ? Math.max(...known.map(s => units(s.points))) : null
    return {
      ...entrant, total, best, wins: known.reduce((sum, s) => sum + s.wins, 0),
      gamesPlayed: known.filter(score => score.played !== false).length,
      pointsFor: total == null ? null : total / UNITS, bestWeek: best == null ? null : best / UNITS,
      missingPeriods: scores.filter(s => !s.row).map(s => s.period).sort((a, b) => a - b),
      provisionalPeriods: scores.filter(s => s.row?.status === 'provisional').map(s => s.period).sort((a, b) => a - b),
      rank: 0, tied: false, seedMovement: null as number | null,
    }
  }).sort((a, b) => compare(a, b) || a.id.localeCompare(b.id))
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    row.rank = i > 0 && compare(rows[i - 1]!, row) === 0 ? rows[i - 1]!.rank : i + 1
    row.tied = (i > 0 && compare(rows[i - 1]!, row) === 0) || (i + 1 < rows.length && compare(row, rows[i + 1]!) === 0)
    const prior = input.previousWeekRanks?.[row.id]
    row.seedMovement = prior != null && Number.isInteger(prior) && prior > 0 ? prior - row.rank : null
  }
  return {
    stageId: input.stageId, rows,
    scoresFinal: rows.every(row => row.missingPeriods.length === 0 && row.provisionalPeriods.length === 0),
  }
}

type Standings = ReturnType<typeof computeSeasonTournamentStandings>
type Qualification = { advance: number; automaticPerLeague: number; wildcards: number }
type Cut = { ok: false; reason: string } | {
  ok: true
  advancing: { entrantId: string; seed: number; path?: 'automatic' | 'wildcard' }[]
  eliminated: string[]
}

/** A cut preview, never a database mutation. */
export function previewSeasonTournamentCut(board: Standings, qualification?: Qualification): Cut {
  if (qualification) return previewConfiguredCut(board, qualification)
  if (board.rows.length < 2 || board.rows.length % 2 !== 0) return { ok: false as const, reason: 'A half-field cut requires an even entrant count.' }
  if (!board.scoresFinal) return { ok: false as const, reason: 'Finalize every required score before cutting the field.' }
  const count = board.rows.length / 2
  if (board.rows.slice(0, count).some(row => row.tied)) return { ok: false as const, reason: 'Resolve tied advancing seeds before cutting or redrafting.' }
  return {
    ok: true as const,
    advancing: board.rows.slice(0, count).map(row => ({ entrantId: row.id, seed: row.rank })),
    eliminated: board.rows.slice(count).map(row => row.id),
  }
}

function previewConfiguredCut(board: Standings, policy: Qualification): Cut {
  if (!board.scoresFinal) return { ok: false, reason: 'Finalize every required score before cutting the field.' }
  const groups = new Map<string, Standings['rows']>()
  for (const row of board.rows) {
    const group = groups.get(row.leagueId) ?? []
    group.push(row)
    groups.set(row.leagueId, group)
  }
  const { automaticPerLeague, wildcards, advance } = policy
  if (![automaticPerLeague, wildcards, advance].every(n => Number.isInteger(n) && n >= 0) ||
      advance < 1 || advance >= board.rows.length || groups.size * automaticPerLeague + wildcards !== advance) {
    return { ok: false, reason: 'The published qualification counts do not fit the field.' }
  }
  const tiedAt = (rows: Standings['rows'], line: number) => line > 0 && rows[line - 1]?.rank === rows[line]?.rank
  const automatic = new Set<string>()
  for (const group of groups.values()) {
    if (automaticPerLeague > group.length) return { ok: false, reason: 'A league cannot fill its automatic berths.' }
    if (tiedAt(group, automaticPerLeague)) return { ok: false, reason: 'Resolve the tie at an automatic berth.' }
    for (const row of group.slice(0, automaticPerLeague)) automatic.add(row.id)
  }
  const remaining = board.rows.filter(row => !automatic.has(row.id))
  if (tiedAt(remaining, wildcards)) return { ok: false, reason: 'Resolve the tie at the wildcard cutoff.' }
  const wildcard = new Set(remaining.slice(0, wildcards).map(row => row.id))
  const selected = board.rows.filter(row => automatic.has(row.id) || wildcard.has(row.id))
  if (selected.some((row, index) => index > 0 && row.rank === selected[index - 1]!.rank)) {
    return { ok: false, reason: 'Resolve tied advancing seeds before redrafting.' }
  }
  return {
    ok: true,
    advancing: selected.map((row, index) => ({ entrantId: row.id, seed: index + 1, path: automatic.has(row.id) ? 'automatic' : 'wildcard' })),
    eliminated: board.rows.filter(row => !automatic.has(row.id) && !wildcard.has(row.id)).map(row => row.id),
  }
}
