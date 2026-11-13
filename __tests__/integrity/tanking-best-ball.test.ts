// @vitest-environment node
/**
 * The native tanking scan (lib/integrity/TankingDetectionEngine.ts) files nothing in a league whose lineup
 * sets itself — a Classic Best Ball league or a best ball Guilly league. Every signal the scan has is a lineup
 * decision (an Out or bye starter, a better player left on the bench, an idle start), and in best ball nobody
 * makes one, so a flag there accuses an innocent manager. The fixtures are
 * __tests__/integrity/tanking-native-lineup-cards.test.ts's: the same week flags the same roster in a league
 * with manual lineups (the control below).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  league: {} as Record<string, unknown>,
  assignments: [] as Array<{ rosterId: string; section: string; playerId: string; season: number; week: number }>,
  players: [] as Array<{ rosterId: string; playerId: string; slotType: string; position: string; injuryStatus: string | null; byeWeek: number | null }>,
  created: [] as Array<{ affectedRosterIds: string[] }>,
  matchupReads: 0,
  stamped: 0,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/ai/aiSpendGuard', () => ({ isAiSpendEnabled: () => false }))
vi.mock('@/lib/integrity/integrityNotifier', () => ({ notifyCommissionerOfFlag: vi.fn(async () => {}) }))
vi.mock('@/lib/integrity/tankingPenaltyService', () => ({ onTankingFlagOpened: vi.fn(async () => {}) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueIntegritySettings: {
      findUnique: vi.fn(async () => ({ tankingMonitorEnabled: true, tankingStartWeek: null, tankingSensitivity: 'medium' })),
      upsert: vi.fn(async () => ((h.stamped += 1), {})),
      update: vi.fn(async () => ((h.stamped += 1), {})),
    },
    redraftMatchup: {
      findMany: vi.fn(async () => {
        h.matchupReads += 1
        return [
          {
            homeRosterId: 'r1',
            awayRosterId: 'r2',
            season: { season: 2026 },
            homeRoster: { id: 'r1', teamName: 'Unlucky', ownerName: 'Pat', wins: 0, losses: 5, isEliminated: false },
            awayRoster: { id: 'r2', teamName: 'Lucky', ownerName: 'Sam', wins: 3, losses: 2, isEliminated: false },
            lineupSnapshots: { redraftScoring: { isComplete: true, home: { rosterId: 'r1', points: 41.2 }, away: { rosterId: 'r2', points: 98.4 }, missingPlayerIds: [] } },
          },
        ]
      }),
    },
    roster: {
      findMany: vi.fn(async () => [
        { id: 'af1', redraftRosterId: 'r1', league: { platform: 'native' } },
        { id: 'af2', redraftRosterId: 'r2', league: { platform: 'native' } },
      ]),
    },
    afRosterLineupAssignment: {
      findMany: vi.fn(async ({ where }: { where: { rosterId: { in: string[] }; season: number; week: number } }) =>
        h.assignments.filter((a) => where.rosterId.in.includes(a.rosterId) && a.season === where.season && a.week === where.week),
      ),
    },
    redraftRosterPlayer: {
      findMany: vi.fn(async ({ where }: { where: { rosterId: { in: string[] }; playerId: { in: string[] } } }) =>
        h.players.filter((p) => where.rosterId.in.includes(p.rosterId) && where.playerId.in.includes(p.playerId)),
      ),
    },
    league: { findFirst: vi.fn(async () => h.league) },
    sportsPlayer: { findMany: vi.fn(async () => []) },
    integrityFlag: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: (typeof h.created)[number] }) => (h.created.push(data), { id: `f${h.created.length}` })),
    },
  },
}))

import { scanWeekForTanking } from '@/lib/integrity/TankingDetectionEngine'

const a = (rosterId: string, playerId: string, section: string, week = 5) => ({ rosterId, playerId, section, season: 2026, week })
const p = (rosterId: string, playerId: string, slotType: string, injuryStatus: string | null = null, byeWeek: number | null = 9) =>
  ({ rosterId, playerId, slotType, position: 'WR', injuryStatus, byeWeek })

const BASE = { playoffStartWeek: 15, sport: 'NFL', platform: 'native', settings: {}, bestBallMode: false, leagueVariant: null, leagueType: 'redraft' }

beforeEach(() => {
  h.created = []
  h.matchupReads = 0
  h.stamped = 0
  h.league = { ...BASE }
  // In best ball the stored card is whatever the slots said: an Out starter and a bye starter on it are noise.
  h.assignments = [
    a('af1', 'out-wr', 'starters'), a('af1', 'bye-rb', 'starters'), a('af1', 'ok-qb', 'starters'), a('af1', 'b1', 'bench'),
    a('af2', 'h-qb', 'starters'), a('af2', 'h-wr', 'starters'),
  ]
  h.players = [
    p('r1', 'out-wr', 'BN', 'Out'),
    p('r1', 'bye-rb', 'RB', null, 5),
    p('r1', 'ok-qb', 'QB'),
    p('r1', 'b1', 'BN'),
    p('r2', 'h-qb', 'QB'),
    p('r2', 'h-wr', 'WR'),
  ]
})

describe('tanking scan in a league whose lineup sets itself', () => {
  it.each([
    ['Classic Best Ball (bestBallMode)', { bestBallMode: true }],
    ['Classic Best Ball (leagueType)', { leagueType: 'best_ball' }],
    ['Classic Best Ball (leagueVariant)', { leagueVariant: 'best_ball' }],
    ['best ball Guilly (settings.best_ball)', { leagueType: 'guillotine', leagueVariant: 'guillotine', settings: { best_ball: true } }],
  ])('%s: flags nobody, reads no lineup, and still records the scan', async (_label, over) => {
    h.league = { ...BASE, ...over }
    const r = await scanWeekForTanking('L1', 5)
    expect(r.flags).toEqual([])
    expect(h.created).toEqual([])
    expect(h.matchupReads).toBe(0)
    expect(h.stamped).toBe(1)
  })
})

describe('control: the same week in a league with manual lineups', () => {
  it('flags the roster that started an Out player and a player on bye', async () => {
    const r = await scanWeekForTanking('L1', 5)
    expect(r.flags).toHaveLength(1)
    expect(h.created.map((c) => c.affectedRosterIds)).toEqual([['r1']])
  })

  it('a non-best-ball Guilly league is still scanned', async () => {
    h.league = { ...BASE, leagueType: 'guillotine', leagueVariant: 'guillotine', settings: {} }
    expect((await scanWeekForTanking('L1', 5)).flags).toHaveLength(1)
  })
})
