// @vitest-environment node
/**
 * Lineup receipts (retention item 6, 2026-09-14): points you left on your bench in the last
 * completed weeks, against the EXACT best legal lineup (true Max PF engine) under the
 * league's own slots. Unscored and unreadable weeks are counted, never shown as a number.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  teamFind: vi.fn(),
  leagueFind: vi.fn(),
  scoreFind: vi.fn(),
  rosterFind: vi.fn(),
  playerFind: vi.fn(),
  cacheFind: vi.fn(),
  factFind: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTeam: { findMany: h.teamFind },
    league: { findMany: h.leagueFind },
    leaguePlayerWeeklyScore: { findMany: h.scoreFind },
    roster: { findMany: h.rosterFind },
    sportsPlayer: { findMany: h.playerFind },
    sportsDataCache: { findMany: h.cacheFind },
    transactionFact: { findMany: h.factFind },
  },
}))
vi.mock('@/lib/trade-intel/sleeperTradeGradeService', () => ({ TRADE_GRADES_CACHE_PREFIX: 'trade-grades:v2:' }))

import {
  LINEUP_RECEIPT_WEEKS,
  getDecisionReceipts,
  getLineupReceipts,
} from '@/lib/core-app/decisionReceipts'

const USER = 'u1'
const ICE = { id: 'af-ice', name: 'Ice Kings', platform: 'sleeper', platformLeagueId: 'sl-ice', season: 2026 }
const SLOTS = { roster_positions: ['QB', 'RB', 'WR', 'FLEX', 'BN', 'BN', 'BN'] }

const PLAYERS: Record<string, { name: string; position: string }> = {
  qb: { name: 'Jared Goff', position: 'QB' },
  rb1: { name: 'Jahmyr Gibbs', position: 'RB' },
  rb2: { name: 'David Montgomery', position: 'RB' },
  wr1: { name: 'Amon-Ra St. Brown', position: 'WR' },
  wr2: { name: 'Jameson Williams', position: 'WR' },
  te: { name: 'Sam LaPorta', position: 'TE' },
  ir: { name: 'Injured Guy', position: 'WR' },
}

type Row = { leagueId: string; week: number; playerId: string; isStarter: boolean; points: number }
const row = (week: number, playerId: string, points: number, isStarter: boolean): Row => ({ leagueId: 'sl-ice', week, playerId, isStarter, points })

function db({
  scores = [] as Row[],
  settings = SLOTS as unknown,
  leagueType = 'redraft',
  reserve = [] as string[],
  players = PLAYERS,
}: { scores?: Row[]; settings?: unknown; leagueType?: string; reserve?: string[]; players?: typeof PLAYERS } = {}) {
  h.teamFind.mockResolvedValue([{ leagueId: ICE.id, externalId: '4', platformUserId: 'su-me' }])
  h.leagueFind.mockResolvedValue([{ id: ICE.id, settings, leagueType }])
  h.scoreFind.mockImplementation(async ({ where }: { where: { OR: Array<{ leagueId: string; rosterId: number; week: { in: number[] } }> } }) =>
    scores.filter((s) => where.OR.some((c) => c.leagueId === s.leagueId && c.week.in.includes(s.week) && c.rosterId === 4)),
  )
  h.rosterFind.mockResolvedValue([{ leagueId: ICE.id, playerData: { reserve, taxi: [] } }])
  h.playerFind.mockResolvedValue(
    Object.entries(players).map(([sleeperId, p]) => ({ sleeperId, name: p.name, position: p.position, team: 'DET', sport: 'NFL', imageUrl: null })),
  )
}

/** Week 5: you started WR2 (6.1) in FLEX and benched RB2 (20.3). */
const WEEK5 = [
  row(5, 'qb', 18, true),
  row(5, 'rb1', 15, true),
  row(5, 'wr1', 12, true),
  row(5, 'wr2', 6.1, true),
  row(5, 'rb2', 20.3, false),
  row(5, 'te', 3, false),
]

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset()
  h.cacheFind.mockResolvedValue([])
  h.factFind.mockResolvedValue([])
})

describe('getLineupReceipts', () => {
  it('🛑 the exact best lineup (FLEX included): points left, the best benched and the weakest starter named', async () => {
    db({ scores: WEEK5 })
    const out = await getLineupReceipts({ userId: USER, leagues: [ICE], currentWeek: 6 })
    expect(out?.lineups).toEqual([
      expect.objectContaining({
        leagueName: 'Ice Kings',
        week: 5,
        pointsLeft: 14.2,
        perfect: false,
        benched: { name: 'David Montgomery', points: 20.3 },
        started: { name: 'Jameson Williams', points: 6.1 },
        href: '/core/my-team?league=af-ice',
      }),
    ])
  })

  it('🛑 with several benched players in the best lineup, it names the BIGGEST miss and the WEAKEST starter', async () => {
    db({
      scores: [
        row(5, 'qb', 18, true),
        row(5, 'rb1', 3, true), // weakest starter
        row(5, 'wr1', 12, true),
        row(5, 'wr2', 6.1, true),
        row(5, 'rb2', 20.3, false), // biggest miss
        row(5, 'te', 9, false), // also belongs in FLEX over wr2
      ],
    })
    const out = await getLineupReceipts({ userId: USER, leagues: [ICE], currentWeek: 6 })
    expect(out?.lineups[0]).toMatchObject({
      pointsLeft: 20.2, // best 18+20.3+12+9 = 59.3, actual 18+3+12+6.1 = 39.1
      benched: { name: 'David Montgomery', points: 20.3 },
      started: { name: 'Jahmyr Gibbs', points: 3 },
    })
  })

  it('a perfect lineup is stated as perfect, with no swap', async () => {
    db({ scores: [row(5, 'qb', 18, true), row(5, 'rb1', 15, true), row(5, 'wr1', 12, true), row(5, 'rb2', 9, true), row(5, 'wr2', 2, false)] })
    const out = await getLineupReceipts({ userId: USER, leagues: [ICE], currentWeek: 6 })
    expect(out?.lineups[0]).toMatchObject({ pointsLeft: 0, perfect: true, benched: null, started: null })
  })

  it(`🛑 only completed weeks — the ${LINEUP_RECEIPT_WEEKS} before the current one — and weeks with no scores are counted, not zero`, async () => {
    db({ scores: WEEK5 })
    const out = await getLineupReceipts({ userId: USER, leagues: [ICE], currentWeek: 6 })
    expect(h.scoreFind.mock.calls[0][0].where.OR[0].week.in).toEqual([5, 4, 3])
    expect(out?.unscored).toBe(2)
    expect(out?.lineups.map((l) => l.week)).toEqual([5])
  })

  it('🛑 a starter with no position on file makes the week unreadable, never a number', async () => {
    const { wr2: _dropped, ...withoutWr2 } = PLAYERS
    db({ scores: WEEK5, players: withoutWr2 as typeof PLAYERS })
    const out = await getLineupReceipts({ userId: USER, leagues: [ICE], currentWeek: 6 })
    expect(out).toMatchObject({ lineups: [], unreadable: 1 })
  })

  it('🛑 a bench player on your reserve/taxi list is not put in the best lineup', async () => {
    db({ scores: [...WEEK5, row(5, 'ir', 40, false)], reserve: ['ir'] })
    const out = await getLineupReceipts({ userId: USER, leagues: [ICE], currentWeek: 6 })
    expect(out?.lineups[0]).toMatchObject({ pointsLeft: 14.2, benched: { name: 'David Montgomery', points: 20.3 } })
  })

  it('🛑 an unrecognised slot makes every looked-at week unreadable and reads no scores', async () => {
    db({ scores: WEEK5, settings: { roster_positions: ['QB', 'MYSTERY', 'BN'] } })
    const out = await getLineupReceipts({ userId: USER, leagues: [ICE], currentWeek: 6 })
    expect(out).toEqual({ lineups: [], unscored: 0, unreadable: 3 })
    expect(h.scoreFind).not.toHaveBeenCalled()
  })

  it('🛑 best-ball leagues have no start/sit and are skipped', async () => {
    db({ scores: WEEK5, leagueType: 'best_ball' })
    const out = await getLineupReceipts({ userId: USER, leagues: [ICE], currentWeek: 6 })
    expect(out).toEqual({ lineups: [], unscored: 0, unreadable: 0 })
    db({ scores: WEEK5, settings: { ...SLOTS, best_ball: 1 } })
    expect((await getLineupReceipts({ userId: USER, leagues: [ICE], currentWeek: 6 }))?.lineups).toEqual([])
  })

  it('a week whose best lineup still has an empty seat is unreadable', async () => {
    db({ scores: [row(5, 'rb1', 15, true), row(5, 'wr1', 12, true), row(5, 'rb2', 9, true)] }) // no QB at all
    const out = await getLineupReceipts({ userId: USER, leagues: [ICE], currentWeek: 6 })
    expect(out).toMatchObject({ lineups: [], unreadable: 1 })
  })

  it('no current week, week 1, two claimed teams, or no Sleeper league → null', async () => {
    db({ scores: WEEK5 })
    expect(await getLineupReceipts({ userId: USER, leagues: [ICE], currentWeek: null })).toBeNull()
    expect(await getLineupReceipts({ userId: USER, leagues: [ICE], currentWeek: 1 })).toBeNull()
    expect(await getLineupReceipts({ userId: USER, leagues: [{ ...ICE, platform: 'espn' }], currentWeek: 6 })).toBeNull()
    h.teamFind.mockResolvedValue([{ leagueId: ICE.id, externalId: '4', platformUserId: null }, { leagueId: ICE.id, externalId: '5', platformUserId: null }])
    expect(await getLineupReceipts({ userId: USER, leagues: [ICE], currentWeek: 6 })).toBeNull()
  })
})

describe('getDecisionReceipts + lineups', () => {
  it('🛑 lineups ride alongside the other kinds and fail alone', async () => {
    db({ scores: WEEK5 })
    h.cacheFind.mockRejectedValue(new Error('cache down'))
    const out = await getDecisionReceipts({ userId: USER, leagues: [ICE], ownerSleeperId: 'sl-me', currentWeek: 6 })
    expect(out?.trades).toEqual([])
    expect(out?.lineups?.[0]).toMatchObject({ week: 5, pointsLeft: 14.2 })
  })
})
