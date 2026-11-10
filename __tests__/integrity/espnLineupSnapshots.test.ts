import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  settings: vi.fn(),
  league: vi.fn(),
  rosters: vi.fn(),
  latestGame: vi.fn(),
  games: vi.fn(),
  crosswalk: vi.fn(),
  projections: vi.fn(),
  upsert: vi.fn(),
  prior: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueIntegritySettings: { findMany: m.settings },
    league: { findUnique: m.league },
    roster: { findMany: m.rosters },
    sportsGame: { findFirst: m.latestGame, findMany: m.games },
  },
}))
vi.mock('@/lib/core-app/playerProjections', () => ({ lookupProjections: m.projections }))
vi.mock('@/lib/projections/leagueScoring', () => ({ extractScoringSettings: () => ({}), computeLeagueProjectedPoints: () => null }))
vi.mock('@/lib/core-app/rosterIdCrosswalk', () => ({ crosswalkToSleeperIds: m.crosswalk }))
vi.mock('@/lib/core-app/byeWeekMap', () => ({ resolveByeWeekMap: async () => ({ SF: 10 }) }))
vi.mock('@/lib/core-app/injuryStatusById', () => ({ readInjuryStatusById: async () => new Map() }))
vi.mock('@/lib/integrity/lineupLockStore', () => ({ lineupLockSnapshotsReady: async () => true, readLineupLockSnapshots: m.prior, upsertPlayers: m.upsert }))

import { readEspnWeekCards, runEspnLineupSnapshots } from '@/lib/integrity/espnLineupSnapshots'

const NOW = new Date('2026-11-15T20:00:00Z')
const KC_KICK = new Date('2026-11-15T18:00:00Z')
const LATE_KICK = new Date('2026-11-15T21:25:00Z')

const espnRoster = (teamId: string, updatedAt: Date, starters: string[]) => ({
  updatedAt,
  playerData: {
    source_provider: 'espn',
    source_team_id: teamId,
    players: ['3916387', '4241389', '-16012'],
    starters,
    player_metadata: { '3916387': { name: 'Early Back', position: 'RB', team: 'KC' }, '4241389': { name: 'Late Wideout', position: 'WR', team: 'LAR' } },
  },
})

beforeEach(() => {
  vi.clearAllMocks()
  m.settings.mockResolvedValue([{ leagueId: 'E1' }])
  m.league.mockResolvedValue({ sport: 'NFL', season: 2026, settings: { roster_positions: ['QB:1', 'RB:2', 'WR:2', 'D/ST:1', 'BE:6'] }, taxiSlots: 0, irSlots: 0, lastSyncedAt: new Date('2026-11-15T19:55:00Z') })
  m.latestGame.mockResolvedValue({ week: 11 })
  m.games.mockResolvedValue([
    { week: 10, homeTeam: 'NYG', awayTeam: 'DAL', startTime: new Date('2026-11-10T01:15:00Z') },
    { week: 11, homeTeam: 'KC', awayTeam: 'DEN', startTime: KC_KICK },
    { week: 11, homeTeam: 'LAR', awayTeam: 'SEA', startTime: LATE_KICK },
    { week: 11, homeTeam: 'Kansas City Chiefs', awayTeam: 'Denver Broncos', startTime: KC_KICK }, // a full-name source: harmless
  ])
  m.crosswalk.mockResolvedValue(new Map([['3916387', 'sl-early'], ['4241389', 'sl-late']]))
  m.projections.mockResolvedValue(new Map([['sl-early', { projectedPoints: 12 }], ['sl-late', { projectedPoints: 9 }], ['KC', { projectedPoints: 7 }]]))
  m.prior.mockResolvedValue([])
  m.rosters.mockResolvedValue([espnRoster('4', new Date('2026-11-15T19:50:00Z'), ['3916387', '-16012'])])
})

describe('runEspnLineupSnapshots', () => {
  it('records, keyed by the ESPN teamId, who started — frozen only for players whose game began before the roster was read', async () => {
    const out = await runEspnLineupSnapshots({ now: NOW })
    expect(out).toMatchObject({ leagues: 1, teams: 1, written: 1, failures: [], unmapped: 0 })
    const arg = m.upsert.mock.calls[0][0]
    expect(arg).toMatchObject({ leagueId: 'E1', rosterId: '4', season: 2026, week: 11 })
    expect(arg.slots.map((s: { slot: string }) => s.slot)).toEqual(['QB', 'RB', 'RB', 'WR', 'WR', 'DST'])
    // KC kicked off at 18:00 and the roster was read at 19:50: final.
    expect(arg.players['3916387']).toMatchObject({ started: true, proj: 12, team: 'KC', frozenAt: '2026-11-15T19:50:00.000Z' })
    // The defence is its club: started, position DST, projected through the club code, frozen with KC.
    expect(arg.players['-16012']).toMatchObject({ started: true, position: 'DST', team: 'KC', proj: 7 })
    expect(arg.players['-16012'].frozenAt).not.toBeNull()
    // LAR has not kicked off: still following the lineup.
    expect(arg.players['4241389']).toMatchObject({ started: false, frozenAt: null })
    expect(m.projections).toHaveBeenCalledWith(expect.arrayContaining(['sl-early', 'sl-late', 'KC']), { season: '2026', week: 11 }, null, 'NFL')
  })

  it('the earlier of the roster and league clocks is the fetch time: a local write cannot pass for a read', async () => {
    m.league.mockResolvedValue({ sport: 'NFL', season: 2026, settings: { roster_positions: ['QB:1', 'RB:2', 'WR:2', 'D/ST:1', 'BE:6'] }, taxiSlots: 0, irSlots: 0, lastSyncedAt: new Date('2026-11-15T17:40:00Z') })
    await runEspnLineupSnapshots({ now: NOW })
    // The league was last synced before KC's kickoff, so nothing is frozen however recent the row is.
    expect(m.upsert.mock.calls[0][0].players['3916387']).toMatchObject({ started: true, frozenAt: null })
  })

  it('counts players with no Sleeper bridge instead of dropping them', async () => {
    m.crosswalk.mockResolvedValue(new Map([['3916387', 'sl-early']]))
    const out = await runEspnLineupSnapshots({ now: NOW })
    expect(out.unmapped).toBe(1)
    expect(m.upsert.mock.calls[0][0].players['4241389']).toMatchObject({ name: 'Late Wideout', proj: null })
  })

  it('skips rather than guesses: unreadable slots, no regular-season week, a non-ESPN roster', async () => {
    m.league.mockResolvedValueOnce({ sport: 'NFL', season: 2026, settings: { roster_positions: ['QB:1', 'EDR:1', 'BE:6'] }, taxiSlots: 0, irSlots: 0, lastSyncedAt: null })
    expect((await runEspnLineupSnapshots({ now: NOW })).skipped).toEqual({ no_slots: 1 })
    m.latestGame.mockResolvedValueOnce(null)
    expect((await runEspnLineupSnapshots({ now: NOW })).skipped).toEqual({ no_week: 1 })
    m.rosters.mockResolvedValueOnce([{ updatedAt: NOW, playerData: { source_provider: 'sleeper', source_team_id: '1', players: ['1'] } }])
    expect((await runEspnLineupSnapshots({ now: NOW })).skipped).toEqual({ no_rosters: 1 })
    expect(m.upsert).not.toHaveBeenCalled()
  })

  it('reads the week from REGULAR-SEASON games only', async () => {
    await runEspnLineupSnapshots({ now: NOW })
    expect(m.latestGame.mock.calls[0][0].where).toMatchObject({ sport: 'NFL', season: 2026, seasonType: 'regular' })
    expect(m.games.mock.calls[0][0].where).toMatchObject({ seasonType: 'regular', week: { in: [10, 11] } })
  })
})

describe('readEspnWeekCards', () => {
  const frozen = (team: string, started: boolean) => ({ team, started, frozenAt: '2026-11-15T22:00:00.000Z', proj: 10, position: 'RB' })
  const live = (team: string, started: boolean) => ({ team, started, frozenAt: null, proj: 10, position: 'WR' })
  const AFTER_WEEK = new Date('2026-11-17T12:00:00Z')

  it('cards only for teams whose capture is complete; the rest are named, never scored from a partial lineup', async () => {
    m.prior.mockResolvedValue([
      { rosterId: '4', players: { a: frozen('KC', true), b: frozen('LAR', false), bye: live('SF', true) } },
      { rosterId: '7', players: { c: frozen('KC', true), d: live('LAR', true) } },
    ])
    const out = await readEspnWeekCards({ leagueId: 'E1', season: 2026, week: 11, now: AFTER_WEEK })
    expect(out.ended).toBe(true)
    expect([...out.cards.keys()]).toEqual(['4'])
    // A bye player has no lock: his last in-week read stands, so a bye starter is counted as started.
    expect(out.cards.get('4')!.starters.map((s) => s.playerId)).toEqual(['a', 'bye'])
    expect(out.incomplete).toEqual([{ rosterId: '7', uncaptured: 1 }])
  })

  it('a week still being played has no cards', async () => {
    m.prior.mockResolvedValue([{ rosterId: '4', players: { a: frozen('KC', true) } }])
    const out = await readEspnWeekCards({ leagueId: 'E1', season: 2026, week: 11, now: NOW })
    expect(out).toMatchObject({ ended: false })
    expect(out.cards.size).toBe(0)
  })
})
