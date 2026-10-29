/**
 * The schedule tab's standings (`buildCanonicalScheduleRuntimeState(...).standings`, its leader line and
 * playoff picture) count every game the standings engine counts: head-to-head, the league median and
 * the odd-team extra matchup.
 *
 * 🛑 THEY COUNTED HEAD-TO-HEAD ONLY. Found by the full-season simulations: a 9-team NFL league (league
 * median on, the creation default for an odd size) showed 10-4-0 on the schedule tab for a team the
 * standings had at 23-5-1, and a different leader.
 */
import { describe, expect, it } from 'vitest'
import type { CanonicalLeagueRules } from '@/lib/league-runtime'
import { buildCanonicalScheduleRuntimeState, type ScheduleRuntimeMatchupInput } from '@/lib/schedule-runtime/canonicalScheduleRuntime'

const RULES = {
  version: 1,
  leagueId: 'L',
  generatedAtIso: new Date(0).toISOString(),
  general: { sport: 'NFL', season: 2026, format: 'redraft', status: 'active' },
  playoffs: { startWeek: 3, teamCount: 2, standingsTiebreakers: [] },
  schedule: { regularSeasonLength: 2, playoffTransitionPoint: 3 },
} as unknown as CanonicalLeagueRules

const TEAMS = ['a', 'b', 'c'].map((rosterId) => ({ rosterId, displayName: rosterId.toUpperCase() }))

// Three teams: one game and one bye each week. Week 1 a 100–b 90, c on a bye scoring 95;
// week 2 b 80–c 120, a on a bye scoring 70.
const ROWS: ScheduleRuntimeMatchupInput[] = [
  { id: 'w1g', week: 1, type: 'regular', homeRosterId: 'a', awayRosterId: 'b', homeScore: 100, awayScore: 90, status: 'final' },
  { id: 'w1b', week: 1, type: 'regular', homeRosterId: 'c', awayRosterId: null, homeScore: 95, awayScore: 0, status: 'final' },
  { id: 'w2g', week: 2, type: 'regular', homeRosterId: 'b', awayRosterId: 'c', homeScore: 80, awayScore: 120, status: 'final' },
  { id: 'w2b', week: 2, type: 'regular', homeRosterId: 'a', awayRosterId: null, homeScore: 70, awayScore: 0, status: 'final' },
]

function records(rows: ScheduleRuntimeMatchupInput[], opts: { medianGame?: boolean } = {}) {
  const state = buildCanonicalScheduleRuntimeState({ rules: RULES, teams: TEAMS, persistedMatchups: rows, currentWeek: 3, status: 'active', ...opts })
  return Object.fromEntries(state.standings.map((r) => [r.rosterId, `${r.wins}-${r.losses}-${r.ties}`]))
}

describe('the schedule tab counts the games the standings count', () => {
  it('head-to-head only when the league plays no median and no extra matchup', () => {
    expect(records(ROWS)).toEqual({ a: '1-0-0', b: '0-2-0', c: '1-0-0' })
  })

  it('adds a league-median game every week, the bye team included', () => {
    // Week 1 scores 100, 90, 95: median 95 — a wins, b loses, c (on the median) ties.
    // Week 2 scores 80, 120, 70: median 80 — c wins, b ties, a loses.
    expect(records(ROWS, { medianGame: true })).toEqual({ a: '2-1-0', b: '0-3-1', c: '2-0-1' })
  })

  it('adds the extra matchup the bye team plays, and only for it under "leftover only"', () => {
    const withExtra = ROWS.map((row) =>
      row.id === 'w1b'
        ? { ...row, lineupSnapshots: { extraMatchup: { opponentRosterId: 'a', rule: 'top_scorer', reason: 'seeded_draw', scoring: 'leftover_only', basisWeek: null, decidedAt: '' } } }
        : row,
    )
    // c's 95 against a's 100 in week 1: a loss for c, nothing for a.
    expect(records(withExtra)).toEqual({ a: '1-0-0', b: '0-2-0', c: '1-1-0' })
  })

  it('plays no median game in a playoff week', () => {
    const playoffWeek: ScheduleRuntimeMatchupInput[] = [
      ...ROWS,
      { id: 'w3g', week: 3, type: 'regular', homeRosterId: 'a', awayRosterId: 'c', homeScore: 60, awayScore: 50, status: 'final' },
    ]
    const regular = records(ROWS, { medianGame: true })
    const withPlayoff = records(playoffWeek, { medianGame: true })
    // The week-3 game itself still lands (a schedule row is a schedule row); no median result does.
    expect(withPlayoff.b).toBe(regular.b)
  })
})
