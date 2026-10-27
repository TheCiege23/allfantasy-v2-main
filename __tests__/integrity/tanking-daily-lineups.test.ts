// @vitest-environment node
/**
 * The tanking scan in a DAILY-LINEUP league reads each day's lineup (lib/integrity/dailyIdleStarts.ts),
 * never the weekly card: a week counts once a team wastes enough starts on players with no game.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DailyRosterFindings, IdleStart } from '@/lib/integrity/dailyIdleStarts'

const h = vi.hoisted(() => ({
  settings: { tankingMonitorEnabled: true, tankingStartWeek: null, tankingSensitivity: 'medium', tankingIllegalLineupCheck: true } as Record<string, unknown>,
  leagueSettings: { sportConfig: { lineupLockType: 'daily', dailyLineupsEnabled: true } } as Record<string, unknown>,
  findings: new Map<string, DailyRosterFindings>(),
  cards: new Map(),
  created: [] as Array<{ affectedRosterIds: string[]; summary: string; evidenceJson: { illegalOrSuspiciousStarters: Array<{ startedPlayerName: string; startedPlayerStatus: string }> } }>,
  loadDaily: vi.fn(),
  loadCards: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/ai/aiSpendGuard', () => ({ isAiSpendEnabled: () => false }))
vi.mock('@/lib/integrity/integrityNotifier', () => ({ notifyCommissionerOfFlag: vi.fn(async () => {}) }))
vi.mock('@/lib/integrity/tankingPenaltyService', () => ({ onTankingFlagOpened: vi.fn(async () => {}) }))
vi.mock('@/lib/integrity/dailyIdleStarts', () => ({ loadDailyIdleStarts: h.loadDaily }))
vi.mock('@/lib/integrity/nativeLineupCards', () => ({ loadNativeLineupCards: h.loadCards }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueIntegritySettings: { findUnique: vi.fn(async () => h.settings), upsert: vi.fn(async () => ({})) },
    redraftMatchup: {
      findMany: vi.fn(async () => [
        {
          homeRosterId: 'r1',
          awayRosterId: 'r2',
          season: { season: 2026 },
          homeRoster: { id: 'r1', teamName: 'Tankers', ownerName: 'Pat', wins: 0, losses: 5, isEliminated: false },
          awayRoster: { id: 'r2', teamName: 'Honest', ownerName: 'Sam', wins: 3, losses: 2, isEliminated: false },
          lineupSnapshots: {},
        },
      ]),
    },
    league: { findFirst: vi.fn(async () => ({ playoffStartWeek: 20, sport: 'NBA', platform: 'native', settings: h.leagueSettings })) },
    sportsPlayer: { findMany: vi.fn(async () => []) },
    integrityFlag: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: (typeof h.created)[number] }) => (h.created.push(data), { id: `f${h.created.length}` })),
    },
  },
}))

import { scanWeekForTanking } from '@/lib/integrity/TankingDetectionEngine'

const idle = (n: number): IdleStart[] =>
  Array.from({ length: n }, (_, i) => ({ day: `2026-11-0${i + 2}`, slot: 'PG', playerId: `p${i}`, playerName: `Idle Guard ${i}`, benchPlayerId: 'b', benchPlayerName: 'Bench Guard' }))

beforeEach(() => {
  vi.clearAllMocks()
  h.created = []
  h.settings = { tankingMonitorEnabled: true, tankingStartWeek: null, tankingSensitivity: 'medium', tankingIllegalLineupCheck: true }
  h.leagueSettings = { sportConfig: { lineupLockType: 'daily', dailyLineupsEnabled: true } }
  h.findings = new Map()
  h.loadDaily.mockImplementation(async () => h.findings)
  // A weekly card that WOULD flag r2 if the scan read it in a daily league.
  h.loadCards.mockImplementation(async () => new Map([['r2', { rosterId: 'r2', starters: [{ playerId: 'x', status: 'OUT' }], bench: [] }]]))
})

describe('tanking scan, daily-lineup league', () => {
  it('flags a team with three wasted starts (medium), naming the players and the bench option', async () => {
    h.findings.set('r1', { idleStarts: idle(3), ruledOutStarters: [] })
    // r1's weekly card names an Out starter too; a daily league must not read it.
    h.loadCards.mockImplementation(async () => new Map([['r1', { rosterId: 'r1', starters: [{ playerId: 'weekly-out', status: 'OUT' }], bench: [] }]]))
    await scanWeekForTanking('L', 3)
    expect(h.loadDaily).toHaveBeenCalledWith(expect.anything(), { sport: 'NBA', season: 2026, week: 3, redraftRosterIds: ['r1', 'r2'] })
    expect(h.created).toHaveLength(1)
    expect(h.created[0].affectedRosterIds).toEqual(['r1'])
    expect(h.created[0].summary).toContain('3 times this week')
    expect(h.created[0].evidenceJson.illegalOrSuspiciousStarters[0]).toMatchObject({ startedPlayerName: 'Idle Guard 0', startedPlayerStatus: 'NO GAME 2026-11-02' })
    expect(h.created[0].evidenceJson.illegalOrSuspiciousStarters.map((x) => x.startedPlayerName)).toEqual(['Idle Guard 0', 'Idle Guard 1', 'Idle Guard 2'])
  })

  it('two wasted starts is carelessness at medium, a flag at high', async () => {
    h.findings.set('r1', { idleStarts: idle(2), ruledOutStarters: [] })
    await scanWeekForTanking('L', 3)
    expect(h.created).toHaveLength(0)
    h.settings = { ...h.settings, tankingSensitivity: 'high' }
    await scanWeekForTanking('L', 3)
    expect(h.created).toHaveLength(1)
  })

  it('a starter listed Out who was started on a game day is flagged, as in a weekly league', async () => {
    h.findings.set('r1', { idleStarts: [], ruledOutStarters: [{ playerId: 'hurt', playerName: 'Hurt Guard', status: 'Out' }] })
    await scanWeekForTanking('L', 3)
    expect(h.created[0].evidenceJson.illegalOrSuspiciousStarters).toEqual([{ slotPosition: 'STARTER', startedPlayerId: 'hurt', startedPlayerName: 'Hurt Guard', startedPlayerStatus: 'OUT' }])
  })

  it('never reads the weekly card in a daily league; the illegal-lineup switch turns it all off', async () => {
    await scanWeekForTanking('L', 3)
    expect(h.created).toHaveLength(0) // r2's weekly card would have flagged
    h.findings.set('r1', { idleStarts: idle(4), ruledOutStarters: [] })
    h.settings = { ...h.settings, tankingIllegalLineupCheck: false }
    await scanWeekForTanking('L', 3)
    expect(h.created).toHaveLength(0)
  })

  it('a weekly-lineup league is unchanged: it reads the weekly card and never the daily lineups', async () => {
    h.leagueSettings = {}
    await scanWeekForTanking('L', 3)
    expect(h.loadDaily).not.toHaveBeenCalled()
    expect(h.created.map((c) => c.affectedRosterIds[0])).toEqual(['r2'])
  })
})
