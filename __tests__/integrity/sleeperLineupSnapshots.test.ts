import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  settings: vi.fn(),
  league: vi.fn(),
  rosters: vi.fn(),
  sports: vi.fn(),
  projections: vi.fn(),
  week: vi.fn(),
  upsert: vi.fn(),
  prior: vi.fn(),
  ready: vi.fn(),
  kickoffs: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueIntegritySettings: { findMany: m.settings },
    league: { findUnique: m.league },
    roster: { findMany: m.rosters },
    sportsPlayer: { findMany: m.sports },
  },
}))
vi.mock('@/lib/core-app/playerProjections', () => ({ lookupProjections: m.projections }))
vi.mock('@/lib/projections/leagueScoring', () => ({
  extractScoringSettings: () => ({ rec: 0.5 }),
  // League scoring: half the stored PPR number, so the test can tell which one was used.
  computeLeagueProjectedPoints: (c: { pts?: number } | null) => (c && typeof c.pts === 'number' ? { points: c.pts / 2 } : null),
}))
vi.mock('@/lib/core-app/slotEligibility', () => ({
  lineupSeatsFromSettings: (s: { slots?: boolean } | null) => (s?.slots === false ? null : [{ slot: 'QB', eligible: ['QB'], count: 1 }, { slot: 'RB', eligible: ['RB'], count: 1 }]),
}))
vi.mock('@/lib/core-app/currentWeek', () => ({ resolveCurrentWeekForLeague: m.week }))
vi.mock('@/lib/core-app/byeWeekMap', () => ({ resolveByeWeekMap: async () => ({ KC: 10 }) }))
vi.mock('@/lib/core-app/injuryStatusById', () => ({ readInjuryStatusById: async () => new Map([['200', 'Questionable']]) }))
vi.mock('@/lib/redraft/lineupLock', () => ({ buildWeekKickoffMap: m.kickoffs, normalizeNflTeam: (t: string) => t }))
vi.mock('@/lib/integrity/lineupLockStore', () => ({ lineupLockSnapshotsReady: m.ready, readLineupLockSnapshots: m.prior, upsertPlayers: m.upsert }))

import { runSleeperLineupSnapshots } from '@/lib/integrity/sleeperLineupSnapshots'

const NOW = new Date('2026-11-08T20:00:00Z')

beforeEach(() => {
  vi.clearAllMocks()
  m.ready.mockResolvedValue(true)
  m.settings.mockResolvedValue([{ leagueId: 'L' }])
  m.league.mockResolvedValue({ sport: 'NFL', season: 2026, settings: {}, platformLeagueId: 'sl-1' })
  m.week.mockResolvedValue({ seasonYear: 2026, week: 9 })
  m.rosters.mockResolvedValue([
    { id: 'r-a', playerData: { source_team_id: '4', players: ['100', '200', '0'] } },
    { id: 'r-b', playerData: { source_team_id: '', players: ['300'] } }, // no roster_id: skipped, never guessed
  ])
  m.sports.mockResolvedValue([
    { sleeperId: '100', name: 'Early Kick', team: 'kc', position: 'QB' },
    { sleeperId: '200', name: 'Late Kick', team: 'SF', position: 'RB' },
  ])
  m.projections.mockResolvedValue(
    new Map([
      ['100', { projectedPoints: 20, componentStats: { pts: 20 }, name: 'Early Kick', position: 'QB', team: 'KC' }],
      ['200', { projectedPoints: 12, componentStats: null, name: 'Late Kick', position: 'RB', team: 'SF' }],
    ]),
  )
  m.kickoffs.mockResolvedValue({ byTeam: new Map([['KC', new Date('2026-11-08T18:00:00Z')], ['SF', new Date('2026-11-09T01:00:00Z')]]) })
  m.prior.mockResolvedValue([])
})

describe('runSleeperLineupSnapshots', () => {
  it('writes one row per Sleeper roster_id, league-scored, frozen at each player’s kickoff', async () => {
    const out = await runSleeperLineupSnapshots({ now: NOW })
    expect(out).toMatchObject({ leagues: 1, teams: 1, written: 1, failures: [] })
    expect(m.projections).toHaveBeenCalledWith(['100', '200'], { season: '2026', week: 9 }, null, 'NFL')
    const arg = m.upsert.mock.calls[0][0]
    expect(arg).toMatchObject({ leagueId: 'L', rosterId: '4', season: 2026, week: 9 })
    expect(arg.slots).toEqual([{ slot: 'QB', eligible: ['QB'] }, { slot: 'RB', eligible: ['RB'] }])
    // League scoring wins when the component stats exist; the stored number is the fallback.
    expect(arg.players['100']).toMatchObject({ proj: 10, team: 'KC', bye: 10, status: null })
    expect(arg.players['200']).toMatchObject({ proj: 12, status: 'Questionable', bye: null })
    // KC kicked off before `now`: frozen. SF has not: still live.
    expect(arg.players['100'].frozenAt).toBe(NOW.toISOString())
    expect(arg.players['200'].frozenAt).toBeNull()
    expect(arg.players['0']).toBeUndefined()
  })

  it('never rewrites a frozen player with a later read', async () => {
    m.prior.mockResolvedValue([{ rosterId: '4', players: { '100': { name: 'Early Kick', position: 'QB', proj: 25, status: null, bye: 10, team: 'KC', frozenAt: '2026-11-08T18:01:00Z' } } }])
    await runSleeperLineupSnapshots({ now: NOW })
    expect(m.upsert.mock.calls[0][0].players['100']).toMatchObject({ proj: 25, frozenAt: '2026-11-08T18:01:00Z' })
  })

  it('skips rather than guesses: not NFL, no slots, a week from another season, and no table', async () => {
    m.league.mockResolvedValueOnce({ sport: 'NBA', season: 2026, settings: {}, platformLeagueId: 'sl-1' })
    expect((await runSleeperLineupSnapshots({ now: NOW })).skipped).toEqual({ not_nfl: 1 })
    m.league.mockResolvedValueOnce({ sport: 'NFL', season: 2026, settings: { slots: false }, platformLeagueId: 'sl-1' })
    expect((await runSleeperLineupSnapshots({ now: NOW })).skipped).toEqual({ no_slots: 1 })
    m.week.mockResolvedValueOnce({ seasonYear: 2025, week: 17 })
    expect((await runSleeperLineupSnapshots({ now: NOW })).skipped).toEqual({ no_week: 1 })
    m.ready.mockResolvedValueOnce(false)
    expect((await runSleeperLineupSnapshots({ now: NOW })).skipped).toEqual({ table_absent: 1 })
    expect(m.upsert).not.toHaveBeenCalled()
  })
})
