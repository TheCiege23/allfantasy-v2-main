// @vitest-environment node
/**
 * 🛑 The tanking scan read `lineupSnapshots` as an array of lineup cards, and no writer stores one:
 * scoring writes `{ redraftScoring: { home, away, … } }`, team totals only. So on every real matchup
 * the scan had no card and flagged nobody. These fixtures use the shape the writers actually produce,
 * and the per-week lineup scoring itself reads (`af_roster_lineup_assignments`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildLineupCards } from '@/lib/integrity/nativeLineupCards'

const h = vi.hoisted(() => ({
  assignments: [] as Array<{ rosterId: string; section: string; playerId: string; season: number; week: number }>,
  players: [] as Array<{ rosterId: string; playerId: string; slotType: string; position: string; injuryStatus: string | null; byeWeek: number | null }>,
  created: [] as Array<{ affectedRosterIds: string[]; evidenceJson: { illegalOrSuspiciousStarters: Array<{ startedPlayerId: string; startedPlayerStatus: string }> } }>,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/ai/aiSpendGuard', () => ({ isAiSpendEnabled: () => false }))
vi.mock('@/lib/integrity/integrityNotifier', () => ({ notifyCommissionerOfFlag: vi.fn(async () => {}) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueIntegritySettings: {
      findUnique: vi.fn(async () => ({ tankingMonitorEnabled: true, tankingStartWeek: null, tankingSensitivity: 'medium' })),
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
          // The shape scoringEngine.ts and serializeSnapshot really write: team totals, no lineup.
          lineupSnapshots: { redraftScoring: { isComplete: true, home: { rosterId: 'r1', points: 41.2 }, away: { rosterId: 'r2', points: 98.4 }, missingPlayerIds: [] } },
        },
      ]),
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
    league: { findFirst: vi.fn(async () => ({ playoffStartWeek: 15, sport: 'NFL', platform: 'native' })) },
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

beforeEach(() => {
  h.created = []
  h.assignments = [
    a('af1', 'out-wr', 'starters'), a('af1', 'bye-rb', 'starters'), a('af1', 'ok-qb', 'starters'), a('af1', 'b1', 'bench'),
    a('af2', 'h-qb', 'starters'), a('af2', 'h-wr', 'starters'),
  ]
  h.players = [
    // `slotType` is CURRENT state — bench for out-wr now. The saved week-5 lineup says he started.
    p('r1', 'out-wr', 'BN', 'Out'),
    p('r1', 'bye-rb', 'RB', null, 5),
    p('r1', 'ok-qb', 'QB'),
    p('r1', 'b1', 'BN'),
    p('r2', 'h-qb', 'QB'),
    p('r2', 'h-wr', 'WR'),
  ]
})

describe('tanking scan on real native matchups', () => {
  it('flags the roster that started an Out player and a player on bye — from the saved week lineup', async () => {
    const r = await scanWeekForTanking('L1', 5)
    expect(r.flags).toHaveLength(1)
    expect(h.created).toHaveLength(1)
    expect(h.created[0].affectedRosterIds).toEqual(['r1'])
    const starters = h.created[0].evidenceJson.illegalOrSuspiciousStarters.map((s) => [s.startedPlayerId, s.startedPlayerStatus])
    expect(starters).toEqual([['out-wr', 'OUT'], ['bye-rb', 'BYE']])
  })

  it('a roster with no saved lineup for the week gets no card and no claim — never the current lineup', async () => {
    h.assignments = h.assignments.filter((x) => x.rosterId !== 'af1')
    const r = await scanWeekForTanking('L1', 5)
    expect(r.flags).toEqual([])
    expect(h.created).toEqual([])
  })

  it('another week’s saved lineup is not this week’s evidence', async () => {
    h.assignments = h.assignments.map((x) => ({ ...x, week: 6 }))
    expect((await scanWeekForTanking('L1', 5)).flags).toEqual([])
  })
})

describe('buildLineupCards', () => {
  it('seats players where the saved lineup put them, and leaves out players it never named', () => {
    const lineups = new Map([['r1', new Map([['s1', 'starters'], ['b1', 'bench'], ['ir1', 'ir']])]])
    const cards = buildLineupCards(
      [p('r1', 's1', 'BN'), p('r1', 'b1', 'WR'), p('r1', 'ir1', 'IR'), p('r1', 'added-later', 'WR')],
      lineups,
    )
    const card = cards.get('r1')!
    expect(card.starters.map((x) => x.playerId)).toEqual(['s1'])
    expect(card.bench.map((x) => x.playerId)).toEqual(['b1'])
  })
})
