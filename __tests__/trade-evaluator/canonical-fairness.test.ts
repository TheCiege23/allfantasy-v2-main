import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockNextRequest } from '@/__tests__/helpers/createMockNextRequest'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import {
  controversyFromLetter,
  fairnessFromGrade,
  fairnessScoreFromPercentDiff,
  vetoRiskFromGrade,
} from '@/lib/decision-os/trade/gradeFairness'

/**
 * 🛑 `/api/trade-evaluator` SHOWS ONE VERDICT (2026-11-26).
 *
 * The route took its letter from the canonical grader but scored fairness itself
 * (`computeLineupFairness` / `computeValueFairness`, 50 + tanh of its own composite totals) and fed
 * that to `evaluateVeto` (≤52 / <55). These tests MOCK THE GRADE and require every fairness / veto
 * field the route returns to follow it — which the old math cannot do, because it never read the
 * grade: run against the pre-change route, the graded cases report a composite number (42 for this
 * 6000-vs-5200 deal) instead of the grade's 60, and the withheld case reports a number instead of null.
 */

const graded = (percentDiff: number, letter: 'A' | 'B' | 'C' | 'D' | 'F', partnerLetter: 'A' | 'B' | 'C' | 'D' | 'F'): TradeGradeView => ({
  graded: true,
  letter,
  partnerLetter,
  percentDiff,
  label: 'test',
  sideAdvantage: percentDiff > 0 ? 'you' : percentDiff < 0 ? 'opponent' : 'even',
  action: 'review',
  recommendation: 'test',
  giveValue: 1000,
  getValue: 1000,
  giveMarket: 1000,
  getMarket: 1000,
  basis: 'Dynasty · Superflex · 12 teams · PPR',
  scoringApplied: true,
  needApplied: false,
  needGap: null,
  lines: [
    { side: 'give', name: 'Player One', marketValue: 1000, leagueValue: 1000 },
    { side: 'get', name: 'Player Two', marketValue: 1000, leagueValue: 1000 },
  ],
  moves: [],
})
const WITHHELD: TradeGradeView = { graded: false, reason: 'No values on file for this league yet.', basis: null }

describe('gradeFairness — fairness and veto read off the one grade', () => {
  it('fairness is 100 − |value gap|, symmetric and clamped', () => {
    expect(fairnessScoreFromPercentDiff(40)).toBe(60)
    expect(fairnessScoreFromPercentDiff(-40)).toBe(60)
    expect(fairnessScoreFromPercentDiff(-140)).toBe(0)
    expect(fairnessFromGrade(graded(40, 'A', 'F'))).toMatchObject({ graded: true, fairnessScore: 60, imbalancePct: 40, controversyLevel: 'high' })
  })

  it('controversy is the letter band, nothing else', () => {
    expect(['A', 'B', 'C', 'D', 'F', null].map(controversyFromLetter)).toEqual(['high', 'medium', 'low', 'medium', 'high', 'unknown'])
  })

  it('veto risk: A/F likely contested, B/D a warning, C nothing', () => {
    expect(vetoRiskFromGrade(graded(40, 'A', 'F'))).toMatchObject({ assessed: true, veto: true, warning: false })
    expect(vetoRiskFromGrade(graded(-15, 'D', 'B'))).toMatchObject({ assessed: true, veto: false, warning: true })
    expect(vetoRiskFromGrade(graded(3, 'C', 'C'))).toMatchObject({ assessed: true, veto: false, warning: false, vetoReason: null, warningText: null })
  })

  it('a withheld grade withholds fairness and veto, with the grader reason', () => {
    expect(fairnessFromGrade(WITHHELD)).toEqual({
      graded: false, fairnessScore: null, imbalancePct: null, percentDiff: null, controversyLevel: 'unknown',
      letter: null, partnerLetter: null, withheldReason: WITHHELD.graded ? '' : WITHHELD.reason,
    })
    expect(vetoRiskFromGrade(WITHHELD)).toMatchObject({ assessed: false, veto: null, warning: null, withheldReason: 'No values on file for this league yet.' })
  })

  it('under a your-team headline, reads the league-value (market) grade', () => {
    const g = { ...graded(40, 'A', 'F'), letterBasis: 'your_team' as const, market: { letter: 'C' as const, partnerLetter: 'C' as const, percentDiff: 4, label: 'Even', giveValue: 1, getValue: 1 } }
    expect(fairnessFromGrade(g)).toMatchObject({ fairnessScore: 96, letter: 'C', controversyLevel: 'low' })
    expect(vetoRiskFromGrade(g)).toMatchObject({ veto: false, warning: false })
  })
})

describe('trade labels judge value only through the grade letter', () => {
  const given = [{ name: '2027 1st', isPick: true, pickRound: 1 }, { name: 'X', position: 'WR', age: 24, tier: 'Tier2' as const }]
  const received = [{ name: 'Y', position: 'WR', age: 28, tier: 'Tier2' as const }]
  it('a D/F letter with a 1st given reads as overpay; an A does not', async () => {
    const { detectTradeLabels } = await import('@/lib/trade-labels')
    expect(detectTradeLabels({ givenAssets: given, receivedAssets: received, gradeLetter: 'F' }).map((l) => l.id)).toContain('overpay_risk')
    expect(detectTradeLabels({ givenAssets: given, receivedAssets: received, gradeLetter: 'A' }).map((l) => l.id)).not.toContain('overpay_risk')
  })
  it('a withheld grade emits no value judgement — only the structural labels', async () => {
    const { detectTradeLabels } = await import('@/lib/trade-labels')
    const ids = detectTradeLabels({ givenAssets: given, receivedAssets: received, gradeLetter: null }).map((l) => l.id)
    expect(ids).toEqual(['pick_burn'])
  })
})

// ───────────────────────────── the route ─────────────────────────────

const { gradeOverride, routeTextCallMock } = vi.hoisted(() => ({
  gradeOverride: { current: null as TradeGradeView | null },
  routeTextCallMock: vi.fn(),
}))

vi.mock('@/lib/decision-os/trade/evaluateTrade', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/decision-os/trade/evaluateTrade')>()
  return {
    ...actual,
    evaluateTrade: (input: Parameters<typeof actual.evaluateTrade>[0], deps?: Parameters<typeof actual.evaluateTrade>[1]) =>
      actual.evaluateTrade(input, {
        ...deps,
        grade: async () => gradeOverride.current!,
        saveReceipt: async () => ({ id: 'receipt-test' }),
      }),
  }
})

vi.mock('next-auth', () => ({ getServerSession: vi.fn().mockResolvedValue({ user: { id: 'user-1' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/feature-toggle', () => ({ isToolTradeAnalyzerEnabled: vi.fn().mockResolvedValue(true) }))
vi.mock('@/lib/league-access', () => ({ assertLeagueMember: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/subscription/entitlement-middleware', () => ({
  requireFeatureEntitlement: vi.fn().mockResolvedValue({ ok: true, decision: {}, tokenSpend: null, tokenPreview: null }),
}))
vi.mock('@/lib/telemetry/usage', () => ({
  withApiUsage: () => (handler: (req: Request) => Promise<Response>) => handler,
}))
vi.mock('@/lib/ai-protection', () => ({
  checkAiRateLimit: vi.fn().mockReturnValue({ allowed: true, retryAfterSec: 0, remaining: 49 }),
  getAiActionConfig: vi.fn().mockReturnValue({ maxRequests: 50, windowMs: 60_000, cacheTtlMs: 0 }),
  getCachedResponse: vi.fn().mockReturnValue(null),
  setCachedResponse: vi.fn(),
  buildCacheKey: vi.fn().mockReturnValue('k'),
  consumeRateLimit: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findFirst: vi.fn().mockResolvedValue(null) } } }))
vi.mock('@/lib/fantasycalc-db', () => ({
  getFantasyCalcValuesDbFirst: vi.fn().mockResolvedValue([
    { value: 6000, player: { id: 1, name: 'Player One', position: 'WR', maybeAge: 25, sleeperId: 'sp-1' } },
    { value: 5200, player: { id: 2, name: 'Player Two', position: 'RB', maybeAge: 26, sleeperId: 'sp-2' } },
  ]),
  getFantasyCalcCacheAgeMs: vi.fn().mockReturnValue(0),
}))
vi.mock('@/lib/sleeper-client', () => ({
  getLeagueInfo: vi.fn().mockResolvedValue(null),
  getLeagueRosters: vi.fn().mockResolvedValue([]),
  getTradedDraftPicks: vi.fn().mockResolvedValue([]),
  getPlayersBySport: vi.fn().mockResolvedValue({}),
}))
vi.mock('@/lib/ai/providerRouter', () => ({ routeTextCall: routeTextCallMock }))
vi.mock('@/lib/openai-client', () => ({
  openaiChatJson: vi.fn().mockResolvedValue({ ok: false }),
  parseJsonContentFromChatCompletion: vi.fn(),
}))
vi.mock('@/lib/player-media', () => ({ attachPlayerMediaBatch: vi.fn().mockResolvedValue(new Map()) }))
vi.mock('@/lib/ai/output-logger', () => ({ logAiOutput: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/ai/pecr', () => ({
  runPECR: vi.fn(async (input: { payload: Record<string, unknown> }) => ({
    output: input, iterations: 1, passed: true, feature: 'trade' as const, allFailures: [] as string[][], durationMs: 1,
  })),
}))

/** A global (no league) evaluation — the path that still runs the route's own pricing. */
function body() {
  return {
    trade_id: 't1',
    sender: { manager_name: 'A', gives_players: ['Player One'], gives_picks: [], gives_faab: 0 },
    receiver: { manager_name: 'B', gives_players: ['Player Two'], gives_picks: [], gives_faab: 0 },
    league: { format: 'dynasty', sport: 'NFL', qb_format: 'sf' },
  }
}

async function evaluate(grade: TradeGradeView) {
  gradeOverride.current = grade
  const { POST } = await import('@/app/api/trade-evaluator/route')
  const res = await POST(
    createMockNextRequest('http://localhost/api/trade-evaluator', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body()),
    }) as any,
  )
  expect(res.status).toBe(200)
  return (await res.json()) as Record<string, any>
}

describe('POST /api/trade-evaluator — fairness and veto follow the canonical grade', () => {
  beforeAll(async () => {
    await import('@/app/api/trade-evaluator/route')
  }, 180_000)
  beforeEach(() => {
    routeTextCallMock.mockResolvedValue({ ok: false })
  })

  it('a lopsided A/F grade: fairness 60 on both sides, likely veto, from the grade', async () => {
    const b = await evaluate(graded(40, 'A', 'F'))
    expect(b.tradeGrade).toMatchObject({ grade: 'A', partnerGrade: 'F' })
    expect(b.tradeInsights.fairnessScore).toBe(60)
    expect(b.tradeInsights.fairnessMethod).toBe('canonical_grade')
    expect(b.valuationReport.teamA.fairnessScore).toBe(60)
    expect(b.valuationReport.teamB.fairnessScore).toBe(60)
    expect(b.tradeInsights.veto).toBe(true)
    expect(b.tradeInsights.vetoReason).toContain('A / F')
    expect(b.tradeInsights.vetoReason).toContain('40%')
    expect(b.tradeInsights.expertWarning).toBeNull()
  })

  it('an even C grade: fairness from the gap, no veto, no warning — whatever the composite says', async () => {
    const b = await evaluate(graded(3, 'C', 'C'))
    expect(b.tradeInsights.fairnessScore).toBe(97)
    expect(b.valuationReport.teamA.fairnessScore).toBe(97)
    expect(b.tradeInsights.veto).toBe(false)
    expect(b.tradeInsights.vetoReason).toBeNull()
    expect(b.tradeInsights.expertWarning).toBeNull()
  })

  it('a withheld grade: no fairness number, no veto verdict, the grader reason instead', async () => {
    const b = await evaluate(WITHHELD)
    expect(b.tradeGrade).toMatchObject({ grade: null })
    expect(b.tradeInsights.fairnessScore).toBeNull()
    expect(b.tradeInsights.veto).toBeNull()
    expect(b.tradeInsights.vetoReason).toBeNull()
    expect(b.tradeInsights.expertWarning).toBeNull()
    expect(b.tradeInsights.fairnessWithheldReason).toBe('No values on file for this league yet.')
    expect(b.valuationReport.teamA.fairnessScore).toBeNull()
    expect(b.valuationReport.teamB.fairnessScore).toBeNull()
    expect(b.valuationReport.teamA.fairnessWithheldReason).toBe('No values on file for this league yet.')
    expect(b.tradeInsights.idpCeilingCaveat).toBeUndefined()
  })

  it('keeps the response shape the page reads', async () => {
    const b = await evaluate(graded(-15, 'D', 'B'))
    // app/trade-evaluator/page.tsx: ApiTradeResponse
    expect(b).toHaveProperty('tradeGrade')
    expect(b).toHaveProperty('evaluation')
    expect(Array.isArray(b.tradeInsights.labels)).toBe(true)
    expect(Array.isArray(b.tradeInsights.warnings)).toBe(true)
    expect(b.tradeInsights).toHaveProperty('netDeltaPct')
    expect(b.tradeInsights).toHaveProperty('vetoReason')
    expect(b.tradeInsights).toHaveProperty('expertWarning')
    for (const side of ['teamA', 'teamB']) {
      for (const k of ['netValue', 'totalGiven', 'totalReceived', 'fairnessScore']) expect(b.valuationReport[side]).toHaveProperty(k)
    }
    // B/D is a warning, never a veto.
    expect(b.tradeInsights.veto).toBe(false)
    expect(b.tradeInsights.expertWarning).toContain('D / B')
    expect(b.tradeInsights.fairnessScore).toBe(85)
  })
})
