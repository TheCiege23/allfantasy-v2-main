// @vitest-environment node
/**
 * 🛑 The dynasty trade analyzer shows THE grade and facts — never the dual-brain engine's verdict
 * (2026-09-29).
 *
 * The page printed the engine's confidence, veto risk, net delta, acceptance %, side totals, key
 * drivers, acceptance likelihood, partner-fit score and a "Ready to Send / Needs Adjustment" call
 * beside the one grade, and its copy text appended the engine's confidence. The route now sends none
 * of that, and the page reads none of it.
 *
 * Every stage after the request is mocked (no DB, no provider, no model call).
 */
import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FormattedTradeResponse } from '@/lib/trade-engine/trade-response-formatter'

const h = vi.hoisted(() => ({
  consensus: vi.fn(),
  format: vi.fn(),
  gate: vi.fn(),
  fallback: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'viewer-1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/ai-protection/costGate', () => ({ aiCostGate: vi.fn(async () => null) }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/trade-engine/trade-context-assembler', () => ({
  assembleTradeDecisionContext: vi.fn(async () => ({
    contextId: 'ctx-1',
    version: 'v1',
    assembledAt: '2026-09-29T00:00:00Z',
    dataQuality: { assetsCovered: 2, assetsTotal: 2, coveragePercent: 100, warnings: [] },
    missingData: { valuationsMissing: [], injuryDataStale: false, tradeHistoryInsufficient: false, adpMissing: [], analyticsMissing: [] },
    valueDelta: { percentageDiff: 26, absoluteDiff: 2113, favoredSide: 'A' },
    sideA: { totalValue: 8123 },
    sideB: { totalValue: 6010 },
    tradeHistoryStats: {},
    dataSources: {},
  })),
  contextToPromptV1: vi.fn(() => ''),
}))
vi.mock('@/lib/ai-context-envelope', () => ({
  tradeContextToEnvelope: vi.fn(() => ({})),
  getMandatorySystemPromptSuffix: vi.fn(() => ''),
  normalizeToContract: vi.fn((raw: unknown) => ({ raw })),
}))
vi.mock('@/lib/trade-engine/dual-brain-trade-analyzer', () => ({ runPeerReviewAnalysis: h.consensus }))
vi.mock('@/lib/trade-engine/quality-gate', () => ({ runQualityGate: h.gate }))
vi.mock('@/lib/trade-engine/trade-response-formatter', () => ({
  formatTradeResponse: h.format,
  computeDeterministicVerdict: vi.fn(() => ({ verdict: { winnerLabel: 'Side A wins this trade' } })),
}))
vi.mock('@/lib/trade-engine/trade-analyzer-intel', () => ({ buildTradeAnalyzerIntelPrompt: vi.fn(async () => '') }))
vi.mock('@/lib/ai-reliability', () => ({ buildStableFallbackResponse: h.fallback, buildReliabilityMetadata: vi.fn(() => ({})) }))
vi.mock('@/lib/decision-os/trade/surfaceShadow', () => ({ recordTradeSurfaceShadow: vi.fn() }))
vi.mock('@/lib/decision-os/trade/evaluateTrade', () => ({
  evaluateTrade: vi.fn(async () => ({
    receiptId: 'r1',
    assets: [],
    grade: { graded: true, letter: 'D', partnerLetter: 'B', label: 'Slightly favors opponent', percentDiff: 8, giveValue: 6400, getValue: 5900, recommendation: null },
  })),
}))

import { POST } from '@/app/api/dynasty-trade-analyzer/route'
import { dynastyAnalyzerSectionsForClient } from '@/lib/trade-engine/dynastyAnalyzerClientView'

const SECTIONS = {
  deterministicVerdict: {
    winner: 'A', winnerLabel: 'Side A wins this trade', fairnessGrade: 'C', fairnessScore: 55, netValueDelta: 2113, netValueDeltaPct: 26,
    acceptanceProbability: 31, acceptanceLikelihood: 'Unlikely', vetoRisk: 'High', confidence: 81, keyDrivers: [{ label: 'Value Gap', value: '26% edge to Side A', impact: 'negative', category: 'value' }],
    sideATotalValue: 8123, sideBTotalValue: 6010, sideANetStarterDelta: 900, sideBNetStarterDelta: -900, injuryRiskDelta: 4, source: 'deterministic-engine',
  },
  valueVerdict: {
    fairnessGrade: 'C', edge: 'Strong edge to Side A (+26%)', edgeSide: 'A', valueDeltaPercent: 26, valueDeltaAbsolute: 2113, sideATotalValue: 8123, sideBTotalValue: 6010,
    confidence: 81, deterministicConfidence: 77, vetoRisk: 'High',
    reasons: ['Bijan is the younger asset'], warnings: ['Josh Allen is 31'],
    dataFreshness: { staleSourceCount: 0, staleSources: [] },
    dataCoverage: { tier: 'FULL', score: 95, badge: { label: 'Full', description: 'd', color: 'green' }, dimensions: { assetCoverage: { score: 1, detail: '' }, sourceFreshness: { score: 1, detail: '' }, dataCompleteness: { score: 1, detail: '' } } },
    recommendationType: { isConditional: false, reasons: [] },
    disagreement: { winnerMismatch: false, confidenceSpread: 4, keyDifferences: [], reviewMode: false },
  },
  viabilityVerdict: {
    acceptanceLikelihood: 'Unlikely', acceptanceScore: 31,
    partnerFit: { needsAlignment: 'Mostly helps Side A\'s needs', surplusMatch: 'No surplus-to-need transfers', fitScore: 60, details: ['Side A fills 1 roster need from this trade'] },
    timing: { sideAWindow: 'Rebuilding', sideBWindow: 'Playoff contender', timingFit: 'Neutral timing', details: [] },
    rankingsImpact: { sideARankDelta: 0.2 }, injuryAdjustedValue: { sideAAdjustedValue: 8000 }, starterBenchDelta: { netStarterDelta: 900 },
    leagueActivity: 'Active trading league', signals: ['Active trading league — deals happen frequently'],
    calibration: { isotonicApplied: true, rawAcceptProbability: 0.29 },
  },
  actionPlan: {
    bestOffer: { assessment: 'This trade heavily favors Side A (+26%). It will almost certainly be rejected as-is.', sendAsIs: false, adjustmentNeeded: 'Major restructuring needed — the 26% gap' },
    counters: [
      { description: 'Ask for a 2027 2nd back', rationale: 'AI-suggested alternative based on roster needs and value alignment' },
      { description: 'Side A could add a future pick to close the 26% gap', rationale: 'Picks are the easiest way to bridge small value differences' },
    ],
    messageText: 'Hey, I wanted to float a trade idea.',
  },
} as unknown as FormattedTradeResponse

const GATE = {
  passed: true, violations: [], deterministicConfidence: 77, originalLLMConfidence: 85, adjustedConfidence: 81,
  filteredReasons: ['Bijan is the younger asset'], filteredCounters: ['Ask for a 2027 2nd back'], filteredWarnings: ['Josh Allen is 31'],
}

/** Every field that carries the engine's verdict or a number on its private scale. */
const PRIVATE_KEYS = [
  'deterministicVerdict', 'deterministicFallback', 'winner', 'winnerLabel', 'dynastyVerdict', 'verdict', 'aiVerdict', 'fairnessGrade', 'fairnessScore',
  'edge', 'edgeSide', 'valueDelta', 'valueDeltaPercent', 'valueDeltaAbsolute', 'netValueDelta', 'netValueDeltaPct', 'sideATotalValue',
  'sideBTotalValue', 'acceptanceProbability', 'acceptanceLikelihood', 'acceptanceScore', 'fitScore', 'vetoRisk', 'keyDrivers', 'bestOffer',
  'rankingsImpact', 'injuryAdjustedValue', 'starterBenchDelta', 'calibration', 'aiCommentary', 'peerReview',
]

function keysIn(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keysIn(v, out))
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(k)
      keysIn(v, out)
    }
  }
  return out
}

async function analyze() {
  const res = await POST(new Request('http://localhost/api/dynasty-trade-analyzer', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sideA: 'Bijan Robinson (RB)', sideB: 'Josh Allen (QB)', leagueContext: '12 team SF', sport: 'NFL' }),
  }))
  expect(res.status).toBe(200)
  return res.json() as Promise<Record<string, any>>
}

describe('POST /api/dynasty-trade-analyzer — no private verdict in the response', () => {
  beforeEach(() => {
    h.consensus.mockReset().mockResolvedValue({ verdict: 'Side A wins', meta: { consensusMethod: 'agreement', providers: [], confidenceAdjustment: 'none' } })
    h.gate.mockReset().mockReturnValue(GATE)
    h.format.mockReset().mockReturnValue(SECTIONS)
    h.fallback.mockReset().mockReturnValue({
      deterministicFallback: { verdict: 'Side A wins this trade', winner: 'A', confidence: 77, reasons: ['Side A has a 26% value edge: 8,123 (A) vs 6,010 (B)'], warnings: ['Missing valuations for: X'] },
      fallbackExplanation: 'AI analysis is temporarily unavailable.',
      reliability: { usedDeterministicFallback: true },
    })
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('🛑 AI path: the one grade and facts, and not one field of the engine’s verdict', async () => {
    const body = await analyze()
    const found = keysIn(body)
    expect(PRIVATE_KEYS.filter((k) => found.has(k))).toEqual([])
    const text = JSON.stringify(body)
    expect(text).not.toMatch(/8123|6010|2113|Side A wins|Ready to Send|26% gap/)
    expect(body.tradeGrade).toMatchObject({ grade: 'D', partnerGrade: 'B' })
    expect(body.analysis.factors).toEqual(['Bijan is the younger asset'])
    expect(body.sections.actionPlan.counters).toEqual([{ description: 'Ask for a 2027 2nd back', rationale: 'AI-suggested alternative based on roster needs and value alignment' }])
    expect(body.sections.viabilityVerdict.partnerFit.needsAlignment).toBe('Mostly helps Side A\'s needs')
  })

  it('🛑 AI-down path: the one grade and the data warnings — not the engine’s verdict, confidence or value-edge reasons', async () => {
    h.consensus.mockResolvedValue(null)
    const body = await analyze()
    const found = keysIn(body)
    expect(PRIVATE_KEYS.filter((k) => found.has(k))).toEqual([])
    expect(JSON.stringify(body)).not.toMatch(/26% value edge|Side A wins|Confidence: 77/)
    expect(body.sections).toBeNull()
    expect(body.analysis.factors).toEqual([])
    expect(body.analysis.agingConcerns).toEqual(['Missing valuations for: X'])
    expect(body.tradeGrade).toMatchObject({ grade: 'D' })
  })
})

describe('dynastyAnalyzerSectionsForClient', () => {
  it('keeps only the facts, and only the counters the AI wrote', () => {
    const view = dynastyAnalyzerSectionsForClient(SECTIONS, ['Ask for a 2027 2nd back'])
    expect(PRIVATE_KEYS.filter((k) => keysIn(view).has(k))).toEqual([])
    expect(keysIn(view).has('confidence')).toBe(false)
    expect(view.valueVerdict.reasons).toEqual(['Bijan is the younger asset'])
    expect(view.viabilityVerdict.timing.sideAWindow).toBe('Rebuilding')
    expect(view.actionPlan.counters.map((c) => c.description)).toEqual(['Ask for a 2027 2nd back'])
    expect(view.actionPlan.messageText).toBe('Hey, I wanted to float a trade idea.')
  })
})

describe('DynastyTradeForm prints none of it', () => {
  const form = fs.readFileSync(path.join(process.cwd(), 'components/DynastyTradeForm.tsx'), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
  const FORM_PRIVATE = /detVerdict|deterministicVerdict|\.confidence\b|acceptanceLikelihood|acceptanceProbability|fitScore|bestOffer|sendAsIs|sideATotalValue|sideBTotalValue|netValueDelta|keyDrivers|vetoRisk|valueDelta\b/

  it('reads no verdict, confidence, acceptance, fit score, totals or delta', () => {
    expect(form.match(FORM_PRIVATE)?.[0] ?? null).toBeNull()
  })

  it('positive controls: the shape matches each line the form printed', () => {
    for (const line of [
      '{detVerdict.confidence}%',
      '<div className="text-lg font-bold font-mono text-white">{detVerdict.netValueDelta.toLocaleString()}</div>',
      '{sections.viabilityVerdict.acceptanceLikelihood}',
      '{sections.viabilityVerdict.partnerFit.fitScore}',
      "{sections.actionPlan.bestOffer.sendAsIs ? 'Ready to Send' : 'Needs Adjustment'}",
      '{sections.valueVerdict.sideATotalValue.toLocaleString()}',
      'confidence={reliability.confidence}',
      '${gradeWinner} — ${result.confidence}% confidence. ${result.valueDelta ?? \'\'}',
    ]) expect(FORM_PRIVATE.test(line)).toBe(true)
  })
})
