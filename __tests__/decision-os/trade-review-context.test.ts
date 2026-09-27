/**
 * The facts behind commissioner review mode (design step 6): where each check's data comes from, and
 * that each missing source says so instead of passing as clear.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { reviewStoredTrade, sideLineup, type TradeReviewDeps } from '@/lib/decision-os/trade/tradeReviewContext'
import type { TradeEvaluationReceipt } from '@/lib/decision-os/trade/evaluateTrade'

const NOW = new Date('2026-11-12T12:00:00.000Z')
const DAY = 86_400_000

const impact = (over: Record<string, unknown>) => ({
  unit: 'league_points_week', week: 10, startingPointsBefore: 110, startingPointsAfter: 90, startingPointsDelta: -20,
  blockedReason: null, unpricedExcluded: 0, depth: [], replacement: [], startersBefore: [], startersAfter: [], ...over,
})

function receipt(over: Partial<TradeEvaluationReceipt> = {}): TradeEvaluationReceipt {
  return {
    receiptId: 'rcpt_review', persisted: true, persistError: null, modelVersion: 'trade-eval-v1', surface: 'commissioner-review',
    evaluatedAt: NOW.toISOString(), inputHash: 'h', leagueId: 'L1', userId: 'commish',
    grade: { graded: true, letter: 'F', partnerLetter: 'A', percentDiff: -48, giveValue: 6000, getValue: 3100 } as never,
    partnerGrade: { graded: true } as never,
    assets: [
      { side: 'give', name: 'Star Runner', kind: 'player', marketValue: 6000, leagueValue: 6000, source: null, adjustments: [] },
      { side: 'get', name: 'Bench Guy', kind: 'player', marketValue: 1600, leagueValue: 1600, source: null, adjustments: [] },
      { side: 'get', name: '2027 Round 2', kind: 'pick', marketValue: 1500, leagueValue: 1500, source: null, adjustments: [] },
    ],
    unpriceable: [],
    canonical: {
      proposerRosterId: 'rA', receiverRosterId: 'rB',
      participants: [
        // Alpha gives its starter and gets bench + a pick: -20 of 110, all bench value → tanking.
        { rosterId: 'rA', action: 'decline', recommendation: '', fairnessScore: null, confidenceScore: 80, coverageStatus: 'complete', coveragePct: 100, memoVersion: null,
          rosterImpact: impact({ startersBefore: ['p1'], startersAfter: ['p7'] }) as never },
        { rosterId: 'rB', action: 'accept', recommendation: '', fairnessScore: null, confidenceScore: 80, coverageStatus: 'complete', coveragePct: 100, memoVersion: null,
          rosterImpact: impact({ startingPointsBefore: 100, startingPointsDelta: 12, startersBefore: ['p2'], startersAfter: ['p1'] }) as never },
      ],
    },
    canonicalError: null, stored: null, teamBenefit: null, teamBenefitRefusal: null, designShadow: null,
    ...over,
  }
}

const trade = (over: Record<string, unknown> = {}) => ({
  id: 't1', leagueId: 'L1', sport: 'NFL', status: 'proposed', proposedAt: null, completedAt: null,
  origin: { source: 'af', platform: 'allfantasy', externalLeagueId: null, externalTradeId: null, deepLink: null, rostersSyncedAt: null, rawStatus: 'awaiting_commissioner' },
  sideA: { teamId: 'rA', rosterId: 'rA', gives: [{ kind: 'player', playerId: 'p1', name: 'Star Runner', position: 'RB' }] },
  sideB: { teamId: 'rB', rosterId: 'rB', gives: [
    { kind: 'player', playerId: 'p2', name: 'Bench Guy', position: 'WR' },
    { kind: 'pick', season: 2027, round: 2, originalTeamId: null, label: '2027 Round 2' },
  ] },
  ...over,
})

const world = {
  league: { season: 2026, sport: 'NFL', currentWeek: 10 },
  teams: [
    { teamId: 'tA', displayName: 'Alpha', source: { sourceTeamId: '1' } },
    { teamId: 'tB', displayName: 'Bravo', source: { sourceTeamId: '2' } },
  ],
  rosters: [
    { rosterId: 'rA', teamId: 'tA', starterIds: ['p1'] },
    { rosterId: 'rB', teamId: 'tB', starterIds: [] },
  ],
}

function deps(over: Partial<TradeReviewDeps> = {}): Partial<TradeReviewDeps> {
  return {
    evaluate: vi.fn(async () => ({ ok: true, trade: trade(), receipt: receipt(), perspectiveTeamId: 'rA', viewerInTrade: false, world })) as never,
    leagueRow: async () => ({ id: 'L1', season: 2026, sport: 'NFL', platformLeagueId: 'SL1', tradeDeadlineWeek: 11, settings: {} }) as never,
    pairHistory: async () => ({ ok: true, value: [-22, -30] }),
    managerHealth: (async () => ({
      leagueId: 'L1', totalManagers: 2, inactiveCount: 1, atRiskCount: 0,
      rows: [
        { rosterId: 'rA', lastActionAt: new Date(NOW.getTime() - 20 * DAY).toISOString() },
        { rosterId: 'rB', lastActionAt: new Date(NOW.getTime() - DAY).toISOString() },
      ],
    })) as never,
    forecast: async () => ({ week: 10, teamForecasts: [{ teamId: '1', playoffProbability: 0.5 }, { teamId: '2', playoffProbability: 81 }] }),
    deadlineKickoff: async () => new Date(NOW.getTime() + 30 * 3_600_000),
    now: () => NOW,
    ...over,
  }
}

const statusOf = async (over: Partial<TradeReviewDeps> = {}) => {
  const r = await reviewStoredTrade({ leagueId: 'L1', ref: { kind: 'af', tradeId: 't1' }, userId: 'commish' }, deps(over))
  if (!r.ok) throw new Error('refused')
  return Object.fromEntries(r.review.checks.map((c) => [c.code, c.status]))
}

describe('reviewStoredTrade — every check fed from its source', () => {
  it('a trade that trips all six: consider a veto', async () => {
    const r = await reviewStoredTrade({ leagueId: 'L1', ref: { kind: 'af', tradeId: 't1' }, userId: 'commish' }, deps())
    if (!r.ok) throw new Error('refused')
    expect(r.sideNames).toEqual(['Alpha', 'Bravo'])
    expect(r.review.checks.map((c) => `${c.code}:${c.status}`)).toEqual([
      'heavily_lopsided:raised', 'tanking_signal:raised', 'repeat_partners:raised',
      'inactive_manager:raised', 'eliminated_team_dumping:raised', 'deadline_rush:raised',
    ])
    expect(r.review.recommendation).toBe('consider_veto')
    const text = r.review.checks.map((c) => c.explanation).join(' | ')
    expect(text).toMatch(/Bravo receives 48% more/)
    expect(text).toMatch(/3 trades this season, and every one favours Bravo/) // [-22, -30] + this one (-48)
    expect(text).toMatch(/Alpha's roster has not changed in 20 days/)
    expect(text).toMatch(/Alpha is out of the playoff race \(0\.5% odds\) and sends starters \(Star Runner\) to Bravo/)
  })

  it('evaluates as the commissioner surface', async () => {
    const evaluate = vi.fn(async () => ({ ok: true, trade: trade(), receipt: receipt(), perspectiveTeamId: 'rA', viewerInTrade: false, world }))
    await reviewStoredTrade({ leagueId: 'L1', ref: { kind: 'af', tradeId: 't1' }, userId: 'commish' }, deps({ evaluate: evaluate as never }))
    expect(evaluate).toHaveBeenCalledWith({ leagueId: 'L1', ref: { kind: 'af', tradeId: 't1' }, userId: 'commish', surface: 'commissioner-review' })
  })

  it('passes a refusal straight through', async () => {
    const refusal = { ok: false, refusal: { code: 'not_found', reason: 'That trade could not be found in this league.' } }
    const r = await reviewStoredTrade({ leagueId: 'L1', ref: { kind: 'af', tradeId: 'x' }, userId: 'commish' }, deps({ evaluate: (async () => refusal) as never }))
    expect(r).toEqual(refusal)
  })
})

describe('reviewStoredTrade — each missing source says so', () => {
  it('a completed trade has no lineup effect: tanking and dumping are not computed', async () => {
    const done = { ok: true, trade: trade({ status: 'completed' }), receipt: receipt(), perspectiveTeamId: 'rA', viewerInTrade: false, world }
    const s = await statusOf({ evaluate: (async () => done) as never })
    expect(s.tanking_signal).toBe('not_computed')
    expect(s.eliminated_team_dumping).toBe('not_computed')
  })

  it('activity is read for native leagues only', async () => {
    const redraft = { ok: true, trade: trade({ origin: { ...trade().origin, source: 'redraft' } }), receipt: receipt(), perspectiveTeamId: 'rA', viewerInTrade: false, world }
    const managerHealth = vi.fn()
    const s = await statusOf({ evaluate: (async () => redraft) as never, managerHealth: managerHealth as never })
    expect(s.inactive_manager).toBe('not_computed')
    expect(managerHealth).not.toHaveBeenCalled()
  })

  it('a forecast older than last week is not an answer', async () => {
    const s = await statusOf({ forecast: async () => ({ week: 7, teamForecasts: [{ teamId: '1', playoffProbability: 0.5 }, { teamId: '2', playoffProbability: 81 }] }) })
    expect(s.eliminated_team_dumping).toBe('not_computed')
  })

  it('no forecast at all is not computed', async () => {
    expect((await statusOf({ forecast: async () => null })).eliminated_team_dumping).toBe('not_computed')
  })

  it('a league with no deadline week is clear; a deadline week with no schedule is not computed', async () => {
    const noDeadline = async () => ({ id: 'L1', season: 2026, sport: 'NFL', platformLeagueId: 'SL1', tradeDeadlineWeek: null, settings: {} }) as never
    expect((await statusOf({ leagueRow: noDeadline })).deadline_rush).toBe('clear')
    expect((await statusOf({ deadlineKickoff: async () => null })).deadline_rush).toBe('not_computed')
  })

  it('history that cannot be read is not computed', async () => {
    expect((await statusOf({ pairHistory: async () => ({ ok: false, reason: 'Trade history between two teams is not joined for imported leagues yet.' }) })).repeat_partners).toBe('not_computed')
  })
})

describe('sideLineup', () => {
  const w = world as never
  it("counts a pick as bench value, and a received player as starter value only if he'd start", () => {
    const a = sideLineup({ receipt: receipt(), side: trade().sideA as never, other: trade().sideB as never, isGradedSide: true, world: w })
    expect(a).toMatchObject({ startingBefore: 110, startingDelta: -20, receivedValue: 3100, receivedBenchValue: 3100, sentStarterNames: ['Star Runner'] })
    const b = sideLineup({ receipt: receipt(), side: trade().sideB as never, other: trade().sideA as never, isGradedSide: false, world: w })
    expect(b).toMatchObject({ receivedValue: 6000, receivedBenchValue: 0 })
  })

  it("prefers the roster's actual starters to the projection for who is sent", () => {
    const b = sideLineup({ receipt: receipt(), side: trade().sideB as never, other: trade().sideA as never, isGradedSide: false, world: { ...world, rosters: [{ rosterId: 'rB', teamId: 'tB', starterIds: [] }] } as never })
    // Bravo's actual lineup is empty on the world, so the projection's starter (p2) is used.
    expect(b?.sentStarterNames).toEqual(['Bench Guy'])
  })

  it('an unpriced line makes the value share unknown rather than guessed', () => {
    const r = receipt({ assets: receipt().assets.map((l) => (l.name === 'Bench Guy' ? { ...l, leagueValue: null } : l)) })
    const a = sideLineup({ receipt: r, side: trade().sideA as never, other: trade().sideB as never, isGradedSide: true, world: w })
    expect(a).toMatchObject({ receivedValue: null, receivedBenchValue: null })
  })

  it('no roster impact → null', () => {
    const r = receipt({ canonical: null })
    expect(sideLineup({ receipt: r, side: trade().sideA as never, other: trade().sideB as never, isGradedSide: true, world: w })).toBeNull()
  })
})
