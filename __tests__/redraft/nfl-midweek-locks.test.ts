import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * NFL 2026 week 12 has games on five of six days: Wednesday (LAR–GB), Thanksgiving Thursday (three),
 * Friday (PIT–DEN), Sunday and Monday. Each player must lock at HIS game's kickoff and stay locked,
 * whatever day it is, in every league that has NFL players.
 *
 * The schedule rows below are the production rows for that week (2026-11-25), feed by feed.
 */

const db = vi.hoisted(() => ({
  roster: { findUnique: vi.fn() },
  league: { findUnique: vi.fn() },
  redraftRoster: { findUnique: vi.fn() },
  redraftRosterPlayer: { findMany: vi.fn() },
  sportsGame: { findMany: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
const weekSvc = vi.hoisted(() => ({ resolve: vi.fn() }))
vi.mock('@/lib/season-week/seasonWeekService', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveSeasonWeekForRedraftSeason: (...a: unknown[]) => weekSvc.resolve(...a),
}))

import { buildWeekKickoffMap, nflConsensusKickoffs } from '@/lib/redraft/lineupLock'
import { clearLineupLockWeekCache, resolveFullLineupLockContext, resolveScheduleLockedPlayerIds } from '@/lib/roster-lineup-engine/lineupLockService'

const at = (iso: string) => new Date(iso)
const RI = at('2026-11-24T19:57:09Z')
const TSDB = at('2026-11-24T18:12:16Z')
const APIS = at('2026-11-24T07:01:38Z')

type Row = { homeTeam: string; awayTeam: string; startTime: Date; seasonType: string | null; source: string; fetchedAt: Date }
const row = (homeTeam: string, awayTeam: string, iso: string, source: string, fetchedAt: Date, seasonType: string | null = 'regular'): Row =>
  ({ homeTeam, awayTeam, startTime: at(iso), seasonType, source, fetchedAt })

const WEEK12: Row[] = [
  // Wednesday 8:00 PM ET
  row('LAR', 'GB', '2026-11-26T01:00:00Z', 'rolling_insights', RI),
  row('Los Angeles Rams', 'Green Bay Packers', '2026-11-26T01:00:00Z', 'thesportsdb', TSDB, null),
  row('LAR', 'GB', '2026-11-26T01:00:00Z', 'api_sports', APIS),
  // Thursday 8:20 PM ET
  row('BUF', 'KC', '2026-11-27T01:20:00Z', 'rolling_insights', RI),
  row('Buffalo Bills', 'Kansas City Chiefs', '2026-11-27T01:20:00Z', 'thesportsdb', TSDB, null),
  row('BUF', 'KC', '2026-11-27T01:20:00Z', 'api_sports', APIS),
  // Friday 3:00 PM ET
  row('PIT', 'DEN', '2026-11-27T20:00:00Z', 'rolling_insights', RI),
  row('PIT', 'DEN', '2026-11-27T20:00:00Z', 'api_sports', APIS),
  // The flexed Sunday games: API-Sports still carries the pre-flex slots.
  row('CLE', 'LV', '2026-11-30T01:20:00Z', 'rolling_insights', RI),
  row('Cleveland Browns', 'Las Vegas Raiders', '2026-11-30T01:20:00Z', 'thesportsdb', TSDB, null),
  row('CLE', 'LV', '2026-11-29T18:00:00Z', 'api_sports', APIS),
  row('JAX', 'TEN', '2026-11-29T18:00:00Z', 'rolling_insights', RI),
  row('Jacksonville Jaguars', 'Tennessee Titans', '2026-11-29T18:00:00Z', 'thesportsdb', TSDB, null),
  row('JAX', 'TEN', '2026-11-29T21:05:00Z', 'api_sports', APIS),
  row('LAC', 'NE', '2026-11-29T21:05:00Z', 'rolling_insights', RI),
  row('Los Angeles Chargers', 'New England Patriots', '2026-11-29T21:05:00Z', 'thesportsdb', TSDB, null),
  row('LAC', 'NE', '2026-11-30T01:20:00Z', 'api_sports', APIS),
  // Monday 8:15 PM ET
  row('TB', 'CAR', '2026-12-01T01:15:00Z', 'rolling_insights', RI),
  row('TB', 'CAR', '2026-12-01T01:15:00Z', 'api_sports', APIS),
]
// Week 1: every team on this roster played in September, so a lock read against week 1 locks them all.
const WEEK1: Row[] = [
  row('KC', 'BAL', '2026-09-11T00:20:00Z', 'rolling_insights', RI),
  row('GB', 'DET', '2026-09-13T17:00:00Z', 'rolling_insights', RI),
  row('DEN', 'LV', '2026-09-13T20:25:00Z', 'rolling_insights', RI),
]

const scheduleDb = (rows: Row[]) => ({ sportsGame: { findMany: vi.fn(async () => rows) } }) as never

describe('NFL kickoffs when the feeds disagree (a flexed game)', () => {
  it('🛑 the two feeds that caught the flex outvote the one that did not', async () => {
    const map = await buildWeekKickoffMap(scheduleDb(WEEK12), { sport: 'NFL', season: 2026, week: 12 })
    expect(map.byTeam.get('CLE')).toEqual(at('2026-11-30T01:20:00Z')) // Sun 8:20 PM ET, not 1:00 PM
    expect(map.byTeam.get('LV')).toEqual(at('2026-11-30T01:20:00Z'))
    expect(map.byTeam.get('JAX')).toEqual(at('2026-11-29T18:00:00Z')) // Sun 1:00 PM ET, not 4:05
    expect(map.byTeam.get('TEN')).toEqual(at('2026-11-29T18:00:00Z'))
    expect(map.byTeam.get('LAC')).toEqual(at('2026-11-29T21:05:00Z')) // Sun 4:05 PM ET, not 8:20
    expect(map.byTeam.get('NE')).toEqual(at('2026-11-29T21:05:00Z'))
    expect(map.warnings.join(' ')).toMatch(/3 NFL schedule row\(s\).*disagreed/)
  })

  it('every midweek game is in the slate: Wednesday, Thursday and Friday teams lock at their own kickoffs', async () => {
    const map = await buildWeekKickoffMap(scheduleDb(WEEK12), { sport: 'NFL', season: 2026, week: 12 })
    expect(map.byTeam.get('GB')).toEqual(at('2026-11-26T01:00:00Z'))
    expect(map.byTeam.get('LAR')).toEqual(at('2026-11-26T01:00:00Z'))
    expect(map.byTeam.get('KC')).toEqual(at('2026-11-27T01:20:00Z'))
    expect(map.byTeam.get('DEN')).toEqual(at('2026-11-27T20:00:00Z'))
    expect(map.byTeam.get('CAR')).toEqual(at('2026-12-01T01:15:00Z'))
    expect(map.firstKickoff).toEqual(at('2026-11-26T01:00:00Z'))
  })

  it('two feeds that disagree with nothing to settle it lock at the EARLIER kickoff', () => {
    const tie = [row('CLE', 'LV', '2026-11-30T01:20:00Z', 'rolling_insights', RI), row('CLE', 'LV', '2026-11-29T18:00:00Z', 'api_sports', APIS)]
    expect(nflConsensusKickoffs(tie).map((r) => r.source)).toEqual(['api_sports'])
  })

  it('a feed more than a day behind on a game does not vote', () => {
    const stale = [
      row('CLE', 'LV', '2026-11-30T01:20:00Z', 'rolling_insights', RI),
      row('CLE', 'LV', '2026-11-29T18:00:00Z', 'api_sports', at('2026-11-20T00:00:00Z')),
    ]
    expect(nflConsensusKickoffs(stale).map((r) => r.source)).toEqual(['rolling_insights'])
  })

  it('rows with no fetch time keep the old rule: the earliest kickoff', () => {
    const bare = [
      { homeTeam: 'CLE', awayTeam: 'LV', startTime: at('2026-11-30T01:20:00Z') },
      { homeTeam: 'CLE', awayTeam: 'LV', startTime: at('2026-11-29T18:00:00Z') },
    ]
    expect(nflConsensusKickoffs(bare).map((r) => r.startTime.toISOString())).toEqual(['2026-11-29T18:00:00.000Z'])
  })
})

const PLAYERS = [
  { playerId: 'jordan-love', team: 'GB' }, // Wednesday
  { playerId: 'mahomes', team: 'KC' }, // Thursday night
  { playerId: 'bo-nix', team: 'DEN' }, // Friday
  { playerId: 'bowers', team: 'LV' }, // flexed to Sunday night
]

function hostedLeague({ seasonWeek, settings = {} as Record<string, unknown>, platform = 'manual' }: { seasonWeek: number; settings?: Record<string, unknown>; platform?: string }) {
  db.roster.findUnique.mockResolvedValue({ redraftRosterId: 'rr1' })
  db.league.findUnique.mockResolvedValue({ platform })
  db.redraftRoster.findUnique.mockResolvedValue({ season: { id: 's1', currentWeek: seasonWeek } })
  db.redraftRosterPlayer.findMany.mockResolvedValue(PLAYERS)
  db.sportsGame.findMany.mockImplementation(async ({ where }: { where: { week?: number } }) => (where.week === 12 ? WEEK12 : where.week === 1 ? WEEK1 : []))
  return {
    leagueId: 'L1', rosterId: 'R1', sport: 'NFL', leagueVariant: null, settings,
    // What the native screen passes today: `settings.currentWeek`, absent on a hosted league -> 1.
    leagueWeek: typeof settings.currentWeek === 'number' ? settings.currentWeek : 1,
    editingWeek: typeof settings.currentWeek === 'number' ? settings.currentWeek : 1,
    season: 2026, playerData: {},
  }
}

const locked = async (args: ReturnType<typeof hostedLeague>, now: string) =>
  (await resolveFullLineupLockContext({ ...args, now: at(now) })).lockedPlayerIds.sort()

describe('the lock reads the week the league is actually on, not settings.currentWeek', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearLineupLockWeekCache()
  })

  it('🛑 a hosted league with no settings week: Wednesday night locks only the Wednesday game', async () => {
    // Before: read as week 1, whose games are all finished, so EVERY player was locked.
    const args = hostedLeague({ seasonWeek: 12 })
    expect(await locked(args, '2026-11-26T01:30:00Z')).toEqual(['jordan-love'])
  })

  it('and the Wednesday player STAYS locked through the week while the rest lock day by day', async () => {
    const args = hostedLeague({ seasonWeek: 12 })
    expect(await locked(args, '2026-11-26T15:00:00Z')).toEqual(['jordan-love']) // Thursday morning
    clearLineupLockWeekCache()
    expect(await locked(args, '2026-11-27T02:00:00Z')).toEqual(['jordan-love', 'mahomes']) // Thursday night
    clearLineupLockWeekCache()
    expect(await locked(args, '2026-11-27T21:00:00Z')).toEqual(['bo-nix', 'jordan-love', 'mahomes']) // Friday
    clearLineupLockWeekCache()
    expect(await locked(args, '2026-11-29T19:00:00Z')).toEqual(['bo-nix', 'jordan-love', 'mahomes']) // Sun 2 PM: LV not yet
    clearLineupLockWeekCache()
    expect(await locked(args, '2026-11-30T02:00:00Z')).toEqual(['bo-nix', 'bowers', 'jordan-love', 'mahomes'])
  })

  it('before Wednesday kickoff nobody is locked', async () => {
    const args = hostedLeague({ seasonWeek: 12 })
    const ctx = await resolveFullLineupLockContext({ ...args, now: at('2026-11-25T20:00:00Z') })
    expect(ctx.lockedPlayerIds).toEqual([])
    expect(ctx.locked).toBe(false)
  })

  it('an imported league with a stale settings week reads the schedule week', async () => {
    const args = hostedLeague({ seasonWeek: 1, settings: { currentWeek: 11 }, platform: 'sleeper' })
    // The imported season's week comes from the committed schedule; stub that read to week 12.
    weekSvc.resolve.mockResolvedValue({ ok: true, fantasyWeek: 12 })
    expect(await locked(args, '2026-11-26T01:30:00Z')).toEqual(['jordan-love'])
    expect(weekSvc.resolve).toHaveBeenCalledWith('s1', expect.anything())
  })

  it('a caller that explicitly asks about another week keeps it', async () => {
    const args = hostedLeague({ seasonWeek: 12 })
    const ctx = await resolveFullLineupLockContext({ ...args, editingWeek: 11, now: at('2026-11-26T01:30:00Z') })
    expect(ctx.locked).toBe(true)
    expect(ctx.policy).toBe('view_only_past')
  })

  it('no redraft season to read: the caller week stands (the old behaviour)', async () => {
    const args = hostedLeague({ seasonWeek: 12 })
    db.roster.findUnique.mockResolvedValue({ redraftRosterId: null })
    const ctx = await resolveFullLineupLockContext({ ...args, now: at('2026-11-26T01:30:00Z') })
    expect(ctx.lockedPlayerIds).toEqual([])
  })

  it('waiver drops use the same schedule lock', async () => {
    const args = hostedLeague({ seasonWeek: 12 })
    const ids = await resolveScheduleLockedPlayerIds({ ...args, now: at('2026-11-27T02:00:00Z') })
    expect(ids?.sort()).toEqual(['jordan-love', 'mahomes'])
  })
})
