// @vitest-environment node
/**
 * The tanking scan with a Lineup Integrity score behind it (lib/integrity/lineupIntegrityWeek.ts).
 *
 *   - one week of benching better players is NOT a case any more, whatever the gap;
 *   - a pattern of low weeks IS a case, even with no single glaring start;
 *   - not owning your own first-round pick lowers the risk one level, and the case says why;
 *   - an unplayable starter with a healthy sub on the bench is still a case — that is a fact, not a judgement.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Card = { rosterId: string; starters: Record<string, unknown>[]; bench: Record<string, unknown>[] }

const h = vi.hoisted(() => ({
  card: null as Card | null,
  weeks: [] as { week: number; ratio: number | null; startedTopCount: number | null; starterCount: number | null; skipReason: string | null }[],
  owns: null as boolean | null,
  eliminated: false,
  created: [] as Record<string, unknown>[],
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/integrity/integrityNotifier', () => ({ notifyCommissionerOfFlag: vi.fn(async () => {}) }))
vi.mock('@/lib/integrity/tankingPenaltyService', () => ({ onTankingFlagOpened: vi.fn(async () => {}) }))
vi.mock('@/lib/integrity/dailySportTankingScan', () => ({ loadDailySportIdleStarts: vi.fn(async () => null) }))
vi.mock('@/lib/integrity/nativeLineupCards', () => ({
  loadNativeLineupCards: vi.fn(async () => new Map(h.card ? [[h.card.rosterId, h.card]] : [])),
}))
vi.mock('@/lib/integrity/lineupIntegrityWeek', () => ({
  scoreLineupIntegrityWeek: vi.fn(async () => {
    const latest = h.weeks.at(-1)
    return new Map([
      [
        'r1',
        {
          thisWeek: latest?.ratio != null ? { scored: true, ratio: latest.ratio, startedProj: 0, optimalProj: 0, startedTopCount: 0, starterCount: 0, excludedIds: [] } : null,
          weeks: h.weeks,
          snapshot: null,
        },
      ],
    ])
  }),
  scoredWeeks: (t: { weeks: { week: number; ratio: number | null }[] }) => t.weeks.map((w) => ({ week: w.week, ratio: w.ratio })),
  ownFirstRoundPicks: vi.fn(async () => ({ season: 2027, owns: new Map(h.owns == null ? [] : [['r1', h.owns]]) })),
}))
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
          awayRosterId: null,
          homeRoster: { id: 'r1', teamName: 'Team One', ownerName: 'Pat', wins: 1, losses: 4, isEliminated: h.eliminated },
          awayRoster: null,
          lineupSnapshots: null,
          season: { season: 2026 },
        },
      ]),
    },
    league: { findFirst: vi.fn(async () => ({ playoffStartWeek: 15, sport: 'NFL', platform: 'manual', settings: {} })) },
    sportsPlayer: { findMany: vi.fn(async () => []) },
    integrityFlag: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        h.created.push(data)
        return { id: `flag${h.created.length}` }
      }),
    },
  },
}))

import { scanWeekForTanking } from '@/lib/integrity/TankingDetectionEngine'

/** A WR starter at 4 projected with a 15-projected WR on the bench: an 11-point bench gap. */
const BENCH_GAP_CARD: Card = {
  rosterId: 'r1',
  starters: [{ playerId: 'wrLow', position: 'WR', slot: 'WR', proj: 4 }],
  bench: [{ playerId: 'wrHigh', position: 'WR', proj: 15 }],
}
const CLEAN_CARD: Card = {
  rosterId: 'r1',
  starters: [{ playerId: 'wrA', position: 'WR', slot: 'WR', proj: 12 }],
  bench: [{ playerId: 'wrB', position: 'WR', proj: 11 }],
}

const week = (w: number, ratio: number | null) => ({ week: w, ratio, startedTopCount: 7, starterCount: 9, skipReason: ratio == null ? 'thin_projections' : null })

beforeEach(() => {
  h.card = null
  h.weeks = []
  h.owns = null
  h.eliminated = false
  h.created = []
})

describe('tanking scan × Lineup Integrity', () => {
  it('one low week with a big bench gap opens no case', async () => {
    h.card = BENCH_GAP_CARD
    h.weeks = [week(4, 0.98), week(5, 0.6)]
    const res = await scanWeekForTanking('L1', 5)
    expect(res.flags).toHaveLength(0)
    expect(h.created).toHaveLength(0)
  })

  it('positive control: without a score, the same bench gap still flags as before', async () => {
    h.card = BENCH_GAP_CARD
    h.weeks = []
    const res = await scanWeekForTanking('L1', 5)
    expect(res.flags).toHaveLength(1)
    expect(res.flags[0].evidence.lineupIntegrity).toBeUndefined()
  })

  it('two low weeks in a row open a case on the pattern alone, and say so', async () => {
    h.card = CLEAN_CARD
    h.weeks = [week(3, 0.95), week(4, 0.8), week(5, 0.82)]
    const res = await scanWeekForTanking('L1', 5)
    expect(res.flags).toHaveLength(1)
    const f = res.flags[0]
    expect(f.evidence.illegalOrSuspiciousStarters).toHaveLength(0)
    expect(f.evidence.lineupIntegrity).toMatchObject({ pattern: true, run: [4, 5], below: 0.85, needed: 2 })
    expect(f.summary).toContain('Lineup Integrity under 85% of the best possible projection 2 weeks in a row.')
    expect(f.severity).toBe('medium')
    expect(f.evidence.consecutiveWeeksWithSuspiciousLineup).toBe(2)
  })

  it('an unscored week neither counts toward nor breaks the run', async () => {
    h.card = CLEAN_CARD
    h.weeks = [week(3, 0.8), week(4, null), week(5, 0.82)]
    const res = await scanWeekForTanking('L1', 5)
    expect(res.flags[0]?.evidence.lineupIntegrity?.run).toEqual([3, 5])
  })

  it('a team without its own first-round pick is rated one level lower, with the reason on the case', async () => {
    h.card = CLEAN_CARD
    h.weeks = [week(3, 0.7), week(4, 0.7), week(5, 0.7)]
    h.owns = true
    const owning = (await scanWeekForTanking('L1', 5)).flags[0]
    expect(owning.severity).toBe('high')
    expect(owning.evidence.redFlags.join(' ')).toMatch(/Owns its own 2027 first-round pick/)

    h.owns = false
    const without = (await scanWeekForTanking('L1', 5)).flags[0]
    expect(without.severity).toBe('medium')
    expect(without.evidence.redFlags.join(' ')).toMatch(/Does not own its own 2027 first-round pick/)
  })

  it('an OUT starter with a healthy sub is still a case without any pattern', async () => {
    h.card = {
      rosterId: 'r1',
      starters: [{ playerId: 'rbOut', position: 'RB', slot: 'RB', status: 'Out', proj: 0 }],
      bench: [{ playerId: 'rbOk', position: 'RB', proj: 9 }],
    }
    h.weeks = [week(4, 0.99), week(5, 0.9)]
    const res = await scanWeekForTanking('L1', 5)
    expect(res.flags).toHaveLength(1)
    expect(res.flags[0].evidence.illegalOrSuspiciousStarters[0]).toMatchObject({ startedPlayerId: 'rbOut', startedPlayerStatus: 'OUT' })
    expect(res.flags[0].evidence.lineupIntegrity).toMatchObject({ pattern: false })
  })
})
