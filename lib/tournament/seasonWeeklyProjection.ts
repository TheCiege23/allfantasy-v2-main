import { z } from 'zod'
import type { SeasonRules } from './seasonRules'
import { nbaStartCap, scoringPeriodForGame } from './seasonRules'

const id = z.string().min(1).max(200)
const instant = z.string().datetime({ offset: true })
export const seasonWeeklyEvidenceSchema = z.object({
  sport: z.enum(['NFL', 'NBA']), period: z.number().int().positive(),
  rulesHash: id, rosterHash: id, source: id,
  coverage: z.enum(['missing', 'provisional', 'complete']),
  // The ingest adapter must reconcile schedule coverage, including postponed/cancelled games.
  observedAt: instant,
  rosters: z.array(z.object({ rosterId: id, playerIds: z.array(id).min(1) })).min(1),
  games: z.array(z.object({ gameId: id, actualStartsAt: instant, playerIds: z.array(id),
    // A snapshot from the lock service, never the roster's current editable lineup.
    lineups: z.array(z.object({ rosterId: id, lockedAt: instant, starterIds: z.array(id) })),
  })),
  scores: z.array(z.object({ gameId: id, playerId: id, revision: z.number().int().positive(),
    status: z.enum(['provisional', 'final']), points: z.number().finite().min(-1000000).max(1000000),
  })),
}).strict()
export type SeasonWeeklyEvidence = z.infer<typeof seasonWeeklyEvidenceSchema>
export type SeasonTeamWeekProjection = {
  rosterId: string; points: number | null; knownPoints: number; countedStarts: number;
  excludedStarts: number; missing: string[]; provisional: string[];
}
const UNITS = 10000
function units(points: number) {
  const value = Math.round(points * UNITS)
  if (!Number.isSafeInteger(value) || Math.abs(points * UNITS - value) > 0.00001) throw new Error('Scores support at most four decimal places.')
  return value
}
function distinct(values: string[], label: string) {
  if (new Set(values).size !== values.length) throw new Error(label + ' must be distinct.')
}

/**
 * Pure internal policy, not an ingestion endpoint or a finalization receipt.
 * Points must come from a trusted scorer using the EXACT frozen rulesHash.
 * Identity mapping, schedule coverage, legal locked lineups and source finality are adapter obligations.
 * No live database writes, launch permission, synthetic opponents or inferred wins.
 */
export function projectSeasonWeek(rules: SeasonRules, expected: { rulesHash: string; rosterHash: string; rosterIds: string[] }, raw: SeasonWeeklyEvidence, now: Date) {
  const input = seasonWeeklyEvidenceSchema.parse(raw)
  if (!Number.isFinite(now.getTime())) throw new Error('A valid server time is required.')
  if (input.sport !== rules.sport || input.rulesHash !== expected.rulesHash || input.rosterHash !== expected.rosterHash) throw new Error('Scoring evidence differs from the frozen rules or prepared rosters.')
  distinct(expected.rosterIds, 'Expected rosters')
  distinct(input.rosters.map(r => r.rosterId), 'Rosters')
  if (expected.rosterIds.length !== input.rosters.length || expected.rosterIds.some(id => !input.rosters.some(r => r.rosterId === id))) throw new Error('Every prepared roster is required.')
  const period = rules.calendar.periods.find(p => p.number === input.period)
  if (!period || [period.startsAt, period.endsAt, period.finalizesAt].some(value => !Number.isFinite(Date.parse(value))) || Date.parse(period.startsAt) >= Date.parse(period.endsAt) || Date.parse(period.finalizesAt) < Date.parse(period.endsAt) + rules.correctionHours * 3600000) throw new Error('A valid dated scoring and correction window is required.')
  const observed = Date.parse(input.observedAt)
  if (observed > now.getTime()) throw new Error('Score evidence cannot be observed in the future.')
  input.rosters.forEach(r => distinct(r.playerIds, 'Roster players'))
  distinct(input.games.map(g => g.gameId), 'Games')
  const games = new Map(input.games.map(g => [g.gameId, g]))
  for (const game of input.games) {
    if (scoringPeriodForGame(rules, game.actualStartsAt) !== input.period || Date.parse(game.actualStartsAt) > observed) throw new Error('Game does not belong to this elapsed scoring period.')
    distinct(game.playerIds, 'Game players')
    distinct(game.lineups.map(l => l.rosterId), 'Game lineups')
    if (game.lineups.length !== input.rosters.length) throw new Error('Every team needs a game lock snapshot.')
    for (const lineup of game.lineups) {
      const roster = input.rosters.find(r => r.rosterId === lineup.rosterId)
      distinct(lineup.starterIds, 'Locked starters')
      const deadline = rules.lineupLock === 'period_start' ? Date.parse(period.startsAt) : Date.parse(game.actualStartsAt)
      if (!roster || lineup.starterIds.some(id => !roster.playerIds.includes(id)) || Date.parse(lineup.lockedAt) > deadline) throw new Error('Lineup snapshot is late or contains an unowned player.')
    }
  }
  const latest = new Map<string, typeof input.scores[number]>()
  const versions = new Map<string, string>()
  for (const row of input.scores) {
    if (!games.get(row.gameId)?.playerIds.includes(row.playerId)) throw new Error('Score lacks a matching game/player identity.')
    const key = JSON.stringify([row.gameId, row.playerId])
    const version = JSON.stringify([row.gameId, row.playerId, row.revision])
    const payload = JSON.stringify([units(row.points), row.status])
    if (versions.has(version) && versions.get(version) !== payload) throw new Error('Conflicting score revision.')
    versions.set(version, payload)
    if (!latest.has(key) || latest.get(key)!.revision < row.revision) latest.set(key, row)
  }
  const cap = rules.sport === 'NBA' ? nbaStartCap(rules, input.period) : null
  // Stable ID order makes simultaneous tipoffs deterministic. The lock adapter must use this same order.
  const orderedGames = [...input.games].sort((a, b) => Date.parse(a.actualStartsAt) - Date.parse(b.actualStartsAt) || (a.gameId < b.gameId ? -1 : a.gameId > b.gameId ? 1 : 0))
  const teams: SeasonTeamWeekProjection[] = input.rosters.map(roster => {
    let total = 0, countedStarts = 0, excludedStarts = 0
    const missing: string[] = [], provisional: string[] = []
    for (const game of orderedGames) {
      const lineup = game.lineups.find(l => l.rosterId === roster.rosterId)!
      for (const playerId of [...lineup.starterIds].sort()) {
        if (!game.playerIds.includes(playerId)) continue
        if (cap !== null && countedStarts >= cap) { excludedStarts++; continue }
        countedStarts++
        const key = JSON.stringify([game.gameId, playerId]), row = latest.get(key)
        if (!row) { missing.push(key); continue }
        total += units(row.points)
        if (!Number.isSafeInteger(total)) throw new Error('Score total exceeds supported precision.')
        if (row.status !== 'final') provisional.push(key)
      }
    }
    const knownPoints = total / UNITS
    return { rosterId: roster.rosterId, points: missing.length || input.coverage !== 'complete' ? null : knownPoints, knownPoints, countedStarts, excludedStarts, missing, provisional }
  })
  const blockers: string[] = []
  if (input.coverage !== 'complete') blockers.push('Schedule and player-score coverage is not complete.')
  if (teams.some(t => t.missing.length)) blockers.push('Counted starter results are missing.')
  if (teams.some(t => t.provisional.length)) blockers.push('Counted starter results are provisional.')
  if (now.getTime() < Date.parse(period.finalizesAt)) blockers.push('The correction window is still open.')
  if (observed < Date.parse(period.finalizesAt)) blockers.push('A source reconciliation after correction closure is required.')
  return { period: input.period, teams, blockers, canFinalize: blockers.length === 0, launchReady: false as const }
}
