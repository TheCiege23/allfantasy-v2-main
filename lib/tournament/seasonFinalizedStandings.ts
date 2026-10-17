import { computeSeasonTournamentStandings } from './seasonTournamentStandings'
import type { SeasonBlueprint } from './seasonBlueprint'
export type OpeningStandingEntrant = { id: string; displayName: string; leagueId: string; leagueKey: string; leagueName: string; rosterId: string }
export type OpeningStandingWeek = { leagueKey: string; period: number; state: 'finalized' | 'missing' | 'unfinalized' | 'review_required'; revision: number; points?: Array<{ rosterId: string; points: number }>; matchupsState?: 'verified' | 'missing' | 'review_required'; outcomes?: Array<{ rosterId: string; wins: 0 | 0.5 | 1; losses: number; ties: number }> }
/** Internal aggregation of DB-verified current receipts. Never accepts client scoring evidence. */
export function buildFinalizedOpeningStandings(input: { entrants: OpeningStandingEntrant[]; periods: number[]; weeks: OpeningStandingWeek[]; tiebreakers: SeasonBlueprint['tiebreakers']; throughPeriod: number }) {
  if (!input.periods.length || input.throughPeriod !== input.periods[input.periods.length - 1] || input.periods.some((p, i) => i > 0 && p !== input.periods[i - 1]! + 1)) throw new Error('A contiguous scoring range through the requested week is required.')
  if (new Set(input.tiebreakers).size !== input.tiebreakers.length || input.tiebreakers.some(t => !['best_week', 'wins', 'previous_seed'].includes(t))) throw new Error('Invalid frozen tiebreakers.')
  const ids = new Set(input.entrants.map(e => e.id)), rosters = new Set(input.entrants.map(e => e.rosterId))
  if (ids.size !== input.entrants.length || rosters.size !== input.entrants.length) throw new Error('Frozen entrant bindings must be distinct.')
  const expected = new Set(input.entrants.map(e => e.leagueKey)), seen = new Set<string>()
  const outcomes = new Map<string, { wins: 0 | 0.5 | 1; losses: number; ties: number }>()
  const results: Parameters<typeof computeSeasonTournamentStandings>[0]['results'] = []
  for (const week of input.weeks) {
    const key = JSON.stringify([week.leagueKey, week.period])
    if (!expected.has(week.leagueKey) || !input.periods.includes(week.period) || seen.has(key)) throw new Error('Unexpected or duplicate league week.')
    seen.add(key)
    if (week.state !== 'finalized') continue
    const members = input.entrants.filter(e => e.leagueKey === week.leagueKey)
    if (!Number.isSafeInteger(week.revision) || week.revision < 1 || !week.points || week.points.length !== members.length || new Set(week.points.map(p => p.rosterId)).size !== members.length) throw new Error('Finalized week must cover every frozen team.')
    if (week.matchupsState === 'verified') {
      if (!week.outcomes || week.outcomes.length !== members.length || new Set(week.outcomes.map(o => o.rosterId)).size !== members.length) throw new Error('Verified matchups must cover every team.')
      for (const outcome of week.outcomes) {
        if (!members.some(m => m.rosterId === outcome.rosterId) || ![0, 0.5, 1].includes(outcome.wins) || outcome.losses !== (outcome.wins === 0 ? 1 : 0) || outcome.ties !== (outcome.wins === 0.5 ? 1 : 0)) throw new Error('Invalid verified matchup outcome.')
        outcomes.set(JSON.stringify([outcome.rosterId, week.period]), outcome)
      }
    } else if (week.outcomes) throw new Error('Unverified matchup outcomes cannot enter standings.')
    for (const score of week.points) {
      const entrant = members.find(e => e.rosterId === score.rosterId)
      if (!entrant) throw new Error('Finalized score differs from its frozen league.')
      // Unknown wins use an internal placeholder only while the wins criterion is disabled for the whole field.
      results.push({ stageId: 'opening', entrantId: entrant.id, leagueId: entrant.leagueId, period: week.period, revision: week.revision, points: score.points, status: 'final', wins: outcomes.get(JSON.stringify([score.rosterId, week.period]))?.wins ?? 0 })
    }
  }
  if (seen.size !== expected.size * input.periods.length) throw new Error('Every required league/week status must be explicit.')
  // Stop at the first unsupported criterion; never apply a later tiebreaker past unknown wins.
  const winsAt = input.tiebreakers.indexOf('wins')
  const matchupsFinal = outcomes.size === input.entrants.length * input.periods.length
  const supported = winsAt < 0 || matchupsFinal ? input.tiebreakers : input.tiebreakers.slice(0, winsAt)
  const board = computeSeasonTournamentStandings({ stageId: 'opening', entrants: input.entrants.map(e => ({ id: e.id, displayName: e.displayName, leagueId: e.leagueId, previousSeed: null })), periods: input.periods, results, tiebreakers: supported })
  const blockers: string[] = []
  if (!board.scoresFinal) blockers.push('Every required league week needs a current verified finalization checkpoint.')
  if (winsAt >= 0 && !matchupsFinal) blockers.push('Win-based tiebreakers need verified matchup results before seeding.')
  if (board.scoresFinal && board.rows.some(r => r.tied)) blockers.push('Tied teams still need the frozen tiebreakers or an audited resolution.')
  return { mode: 'locked_setup' as const, throughPeriod: input.throughPeriod, periods: input.periods, scoresFinal: board.scoresFinal, matchupsFinal, verifiedMatchupWeeks: input.weeks.filter(w => w.state === 'finalized' && w.matchupsState === 'verified').length, seedingReady: false as const, launchReady: false as const, canAdvance: false as const, blockers,
    verifiedWeeks: input.weeks.filter(w => w.state === 'finalized').length, requiredWeeks: input.weeks.length,
    weeks: input.weeks.map(({ points: _points, outcomes: _outcomes, ...status }) => status),
    rows: board.rows.map(row => { const entrant = input.entrants.find(e => e.id === row.id)!; const known = input.periods.flatMap(period => { const o = outcomes.get(JSON.stringify([entrant.rosterId, period])); return o ? [o] : [] }); const complete = known.length === input.periods.length; const wins = known.length ? known.reduce((sum, o) => sum + o.wins, 0) : null; return { entrantId: row.id, displayName: row.displayName, leagueKey: entrant.leagueKey, leagueName: entrant.leagueName, rank: board.scoresFinal ? row.rank : null, tied: board.scoresFinal && row.tied, pointsFor: row.missingPeriods.length ? null : row.pointsFor, knownFinalizedPoints: row.pointsFor, bestWeek: row.bestWeek, wins: complete ? wins : null, knownVerifiedWins: wins, losses: complete ? known.reduce((sum, o) => sum + o.losses, 0) : null, ties: complete ? known.reduce((sum, o) => sum + o.ties, 0) : null, missingMatchupPeriods: input.periods.filter(period => !outcomes.has(JSON.stringify([entrant.rosterId, period]))), missingPeriods: row.missingPeriods } }),
  }
}
export type SeasonOpeningStandingsReport = ReturnType<typeof buildFinalizedOpeningStandings>
