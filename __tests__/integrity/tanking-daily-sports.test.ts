// @vitest-environment node
/**
 * Tanking scans for NBA, NHL and MLB (lib/integrity/dailySportTankingSignals.ts and
 * dailySportTankingScan.ts). The scan's only "cannot score" test was an NFL bye week, which these
 * sports never carry, so an idle starter there was invisible.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  idle: null as null | { mode: 'daily' | 'weekly'; byRoster: Map<string, Array<{ day: string | null; playerId: string; slot: string; benchPlayerId: string | null }>> },
  sensitivity: 'medium',
  sport: 'NBA',
  created: [] as Array<{ affectedRosterIds: string[]; summary: string; evidenceJson: { illegalOrSuspiciousStarters: Array<Record<string, unknown>> } }>,
  // loader fixtures
  rows: [] as Array<Record<string, unknown>>,
  daily: [] as Array<{ rosterId: string; playerId: string; scoringDay: Date; slotType: string }>,
  weekly: [] as Array<{ rosterId: string; section: string; playerId: string; season: number; week: number }>,
  byTeamDay: new Map<string, Map<string, Date>>(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/ai/aiSpendGuard', () => ({ isAiSpendEnabled: () => false }))
vi.mock('@/lib/integrity/integrityNotifier', () => ({ notifyCommissionerOfFlag: vi.fn(async () => {}) }))
vi.mock('@/lib/integrity/tankingPenaltyService', () => ({ onTankingFlagOpened: vi.fn(async () => {}) }))
vi.mock('@/lib/integrity/dailySportTankingScan', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/integrity/dailySportTankingScan')>()
  return { ...real, loadDailySportIdleStarts: vi.fn(async (...args: Parameters<typeof real.loadDailySportIdleStarts>) => (h.idle === undefined ? real.loadDailySportIdleStarts(...args) : h.idle)) }
})
vi.mock('@/lib/redraft/lineupLock', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/redraft/lineupLock')>()),
  buildWeekKickoffMap: vi.fn(async () => ({ byTeam: new Map(), firstKickoff: null, byTeamDay: h.byTeamDay, warnings: [] })),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueIntegritySettings: {
      findUnique: vi.fn(async () => ({ tankingMonitorEnabled: true, tankingStartWeek: null, tankingSensitivity: h.sensitivity })),
      upsert: vi.fn(async () => ({})),
    },
    redraftMatchup: {
      findMany: vi.fn(async () => [
        {
          homeRosterId: 'r1',
          awayRosterId: 'r2',
          season: { season: 2026 },
          homeRoster: { id: 'r1', teamName: 'Tankers', ownerName: 'Pat', wins: 0, losses: 5, isEliminated: false },
          awayRoster: { id: 'r2', teamName: 'Honest', ownerName: 'Sam', wins: 3, losses: 2, isEliminated: false },
          lineupSnapshots: { redraftScoring: { home: {}, away: {} } },
        },
      ]),
    },
    roster: { findMany: vi.fn(async () => [{ id: 'af1', redraftRosterId: 'r1', league: { platform: 'native' } }, { id: 'af2', redraftRosterId: 'r2', league: { platform: 'native' } }]) },
    afRosterLineupAssignment: {
      findMany: vi.fn(async ({ where }: { where: { rosterId: { in: string[] }; season: number; week: number } }) =>
        h.weekly.filter((a) => where.rosterId.in.includes(a.rosterId) && a.season === where.season && a.week === where.week),
      ),
    },
    redraftRosterPlayer: {
      findMany: vi.fn(async ({ where }: { where: { rosterId: { in: string[] }; playerId?: { in: string[] } } }) =>
        h.rows.filter((r) => where.rosterId.in.includes(String(r.rosterId)) && (!where.playerId || where.playerId.in.includes(String(r.playerId)))),
      ),
    },
    redraftDailyLineup: { findMany: vi.fn(async () => h.daily) },
    league: { findFirst: vi.fn(async () => ({ playoffStartWeek: 23, sport: h.sport, platform: 'native', settings: {} })) },
    sportsPlayer: { findMany: vi.fn(async () => [{ id: 'pg-idle', sleeperId: null, source: 'rolling_insights', name: 'Idle Guard' }, { id: 'pg-bench', sleeperId: null, source: 'rolling_insights', name: 'Bench Guard' }]) },
    integrityFlag: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: (typeof h.created)[number] }) => (h.created.push(data), { id: `f${h.created.length}` })),
    },
  },
}))

import { findIdleStarts, type DailySportPlayer } from '@/lib/integrity/dailySportTankingSignals'
import { loadDailySportIdleStarts } from '@/lib/integrity/dailySportTankingScan'
import { scanWeekForTanking } from '@/lib/integrity/TankingDetectionEngine'
import { TANKING_IDLE_STARTS_PER_WEEK } from '@/lib/integrity/sensitivity'
import { lockTeamLookupKeys } from '@/lib/redraft/lineupLock'
import { prisma } from '@/lib/prisma'

const DAYS = ['2026-11-03', '2026-11-04', '2026-11-05']
const player = (playerId: string, position: string, team: string | null, slotByDay: Record<string, string | null>, daysOnTeam = DAYS): DailySportPlayer => ({
  playerId, position, team, daysOnTeam, slotOn: (day) => (day in slotByDay ? slotByDay[day] : null),
})
/** BOS plays the 4th; NYK plays every day; UNK is not on the schedule at all. */
const plays = (team: string | null, day: string | null) => {
  if (team === 'NYK') return true
  if (team === 'BOS') return day == null ? true : day === '2026-11-04'
  if (team === 'IDLE') return false
  return null
}
const judge = (mode: 'daily' | 'weekly', players: DailySportPlayer[]) =>
  findIdleStarts({
    mode,
    days: DAYS,
    players,
    teamPlays: plays,
    isStarterSlot: (s) => !['BN', 'IR'].includes(s),
    slotAccepts: (slot, pos) => slot === pos || slot === 'UTIL' || (slot === 'G' && ['PG', 'SG'].includes(pos)),
  })

describe('the rule (daily lineups)', () => {
  it('an idle starter counts when an eligible bench player played that day', () => {
    const idle = judge('daily', [
      player('pg-idle', 'PG', 'BOS', { '2026-11-03': 'PG', '2026-11-04': 'PG', '2026-11-05': 'PG' }),
      player('pg-bench', 'PG', 'NYK', { '2026-11-03': 'BN', '2026-11-04': 'BN', '2026-11-05': 'BN' }),
    ])
    expect(idle).toEqual([
      { day: '2026-11-03', playerId: 'pg-idle', slot: 'PG', benchPlayerId: 'pg-bench' },
      { day: '2026-11-05', playerId: 'pg-idle', slot: 'PG', benchPlayerId: 'pg-bench' },
    ])
  })

  it('not when the only bench player cannot fill the slot, or also had no game', () => {
    expect(judge('daily', [player('pg-idle', 'PG', 'BOS', { '2026-11-03': 'PG' }), player('c-bench', 'C', 'NYK', { '2026-11-03': 'BN' })])).toEqual([])
    expect(judge('daily', [player('pg-idle', 'PG', 'BOS', { '2026-11-03': 'PG' }), player('pg-bench', 'PG', 'IDLE', { '2026-11-03': 'BN' })])).toEqual([])
  })

  it('a team the schedule cannot place is never idle, and an unknown slot makes no claim', () => {
    expect(judge('daily', [player('x', 'PG', 'UNK', { '2026-11-03': 'PG' }), player('b', 'PG', 'NYK', { '2026-11-03': 'BN' })])).toEqual([])
    expect(judge('daily', [player('x', 'PG', 'BOS', { '2026-11-03': null }), player('b', 'PG', 'NYK', { '2026-11-03': 'BN' })])).toEqual([])
  })

  it('a day he was not on the team does not count, and a multi-position player fills either', () => {
    expect(judge('daily', [player('x', 'PG', 'BOS', { '2026-11-03': 'PG' }, ['2026-11-04']), player('b', 'PG', 'NYK', { '2026-11-03': 'BN' })])).toEqual([])
    expect(judge('daily', [player('x', 'SG', 'BOS', { '2026-11-03': 'G' }), player('b', 'C/PG', 'NYK', { '2026-11-03': 'BN' })])).toHaveLength(1)
  })
})

describe('the rule (weekly lineups)', () => {
  it('a starter whose team plays no game all week is idle, like an NFL bye; no bench option is needed', () => {
    expect(judge('weekly', [player('x', 'PG', 'IDLE', { '2026-11-05': 'PG' })])).toEqual([{ day: null, playerId: 'x', slot: 'PG', benchPlayerId: null }])
    expect(judge('weekly', [player('x', 'PG', 'BOS', { '2026-11-05': 'PG' })])).toEqual([])
    expect(judge('weekly', [player('x', 'PG', 'UNK', { '2026-11-05': 'PG' })])).toEqual([])
    expect(judge('weekly', [player('x', 'PG', 'IDLE', { '2026-11-05': 'BN' })])).toEqual([])
  })
})

describe('the scan', () => {
  const idleStarts = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ day: `2026-11-0${3 + (i % 5)}`, playerId: 'pg-idle', slot: 'PG', benchPlayerId: 'pg-bench' }))

  beforeEach(() => {
    vi.clearAllMocks()
    h.created = []
    h.sensitivity = 'medium'
    h.sport = 'NBA'
    h.weekly = []
    h.idle = { mode: 'daily', byRoster: new Map() }
  })

  it('flags a daily-lineup team once its idle starts reach the sensitivity threshold, naming both players', async () => {
    h.idle!.byRoster.set('r1', idleStarts(TANKING_IDLE_STARTS_PER_WEEK.medium))
    await scanWeekForTanking('L1', 3)
    expect(h.created).toHaveLength(1)
    expect(h.created[0].affectedRosterIds).toEqual(['r1'])
    expect(h.created[0].summary).toContain('had no game')
    expect(h.created[0].evidenceJson.illegalOrSuspiciousStarters[0]).toMatchObject({
      startedPlayerName: 'Idle Guard', startedPlayerStatus: 'NO GAME THAT DAY', benchedBetterOption: 'Bench Guard', day: '2026-11-03', slotPosition: 'PG',
    })
  })

  it('below the threshold, nothing; the threshold follows the commissioner\'s sensitivity', async () => {
    h.idle!.byRoster.set('r1', idleStarts(TANKING_IDLE_STARTS_PER_WEEK.medium - 1))
    await scanWeekForTanking('L1', 3)
    expect(h.created).toEqual([])
    h.sensitivity = 'high'
    await scanWeekForTanking('L1', 3)
    expect(h.created).toHaveLength(1)
  })

  it('a weekly-lineup league files a no-games-all-week starter as an illegal lineup, one is enough', async () => {
    h.idle = { mode: 'weekly', byRoster: new Map([['r1', [{ day: null, playerId: 'pg-idle', slot: 'PG', benchPlayerId: null }]]]) }
    await scanWeekForTanking('L1', 3)
    expect(h.created[0].evidenceJson.illegalOrSuspiciousStarters).toEqual([
      expect.objectContaining({ startedPlayerName: 'Idle Guard', startedPlayerStatus: 'NO GAMES THIS WEEK', slotPosition: 'PG' }),
    ])
  })

  it('the commissioner\'s sub-rule switches gate them: bench pattern for daily, illegal lineups for weekly', async () => {
    const settings = vi.mocked(prisma.leagueIntegritySettings.findUnique)
    settings.mockResolvedValueOnce({ tankingMonitorEnabled: true, tankingStartWeek: null, tankingSensitivity: 'high', tankingBenchPatternCheck: false } as never)
    h.idle!.byRoster.set('r1', idleStarts(6))
    await scanWeekForTanking('L1', 3)
    expect(h.created).toEqual([])
    settings.mockResolvedValueOnce({ tankingMonitorEnabled: true, tankingStartWeek: null, tankingSensitivity: 'high', tankingIllegalLineupCheck: false } as never)
    h.idle = { mode: 'weekly', byRoster: new Map([['r1', [{ day: null, playerId: 'pg-idle', slot: 'PG', benchPlayerId: null }]]]) }
    await scanWeekForTanking('L1', 3)
    expect(h.created).toEqual([])
  })
})

describe('the loader, on real dates and the lock\'s own team keys', () => {
  const key = (team: string) => lockTeamLookupKeys('NBA', team)[0]!
  beforeEach(() => {
    h.idle = undefined as never // the mock falls through to the real loader
    // NBA 2026 week 3: 3-9 November. Boston plays only the 4th; New York plays the 3rd and the 4th.
    h.byTeamDay = new Map([
      [key('Boston Celtics'), new Map([['2026-11-04', new Date('2026-11-05T00:30:00Z')]])],
      [key('New York Knicks'), new Map([['2026-11-03', new Date('2026-11-04T00:30:00Z')], ['2026-11-04', new Date('2026-11-05T00:30:00Z')]])],
    ])
    const added = new Date('2026-10-01T12:00:00Z')
    h.rows = [
      { rosterId: 'r1', playerId: 'pg-idle', slotType: 'PG', position: 'PG', team: 'Boston Celtics', addedAt: added, droppedAt: null },
      { rosterId: 'r1', playerId: 'pg-bench', slotType: 'BN', position: 'PG', team: 'New York Knicks', addedAt: added, droppedAt: null },
    ]
    h.weekly = []
    h.daily = [
      { rosterId: 'r1', playerId: 'pg-idle', scoringDay: new Date('2026-11-03T00:00:00Z'), slotType: 'PG' },
      { rosterId: 'r1', playerId: 'pg-bench', scoringDay: new Date('2026-11-03T00:00:00Z'), slotType: 'BN' },
    ]
  })

  it('daily mode: the 3rd is an idle start (Boston off, the Knicks guard on the bench played); the 4th is not', async () => {
    const out = await loadDailySportIdleStarts(prisma as never, {
      sport: 'NBA', season: 2026, week: 3, redraftRosterIds: ['r1'],
      leagueSettings: { sportConfig: { lineupLockType: 'daily', dailyLineupsEnabled: true } },
    })
    expect(out?.mode).toBe('daily')
    // The saved rows carry forward all week; after the 4th Boston and New York are both off, so no bench option played.
    expect(out?.byRoster.get('r1')).toEqual([{ day: '2026-11-03', playerId: 'pg-idle', slot: 'PG', benchPlayerId: 'pg-bench' }])
  })

  it('no claim without the week\'s schedule, or for another sport', async () => {
    h.byTeamDay = new Map()
    expect(await loadDailySportIdleStarts(prisma as never, { sport: 'NBA', season: 2026, week: 3, redraftRosterIds: ['r1'], leagueSettings: {} })).toBeNull()
    expect(await loadDailySportIdleStarts(prisma as never, { sport: 'NFL', season: 2026, week: 3, redraftRosterIds: ['r1'], leagueSettings: {} })).toBeNull()
  })
})
