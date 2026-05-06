import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockNextRequest } from '@/__tests__/helpers/createMockNextRequest'

const getServerSessionMock = vi.fn()
const assertLeagueMemberMock = vi.fn()
const requireFeatureEntitlementMock = vi.fn()
const isToolTradeAnalyzerEnabledMock = vi.fn()
const checkAiRateLimitMock = vi.fn()
const getAiActionConfigMock = vi.fn()
const getCachedResponseMock = vi.fn()
const setCachedResponseMock = vi.fn()
const buildCacheKeyMock = vi.fn()

const resolveTradeEvaluatorInternalLeagueIdMock = vi.fn()
const resolveTradePlayerAssetsMock = vi.fn()
const buildNormalizedTradeContextMock = vi.fn()
const buildNormalizedTradeEvidencePromptMock = vi.fn()

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/feature-toggle', () => ({
  isToolTradeAnalyzerEnabled: isToolTradeAnalyzerEnabledMock,
}))

vi.mock('@/lib/league-access', () => ({
  assertLeagueMember: assertLeagueMemberMock,
}))

vi.mock('@/lib/subscription/entitlement-middleware', () => ({
  requireFeatureEntitlement: requireFeatureEntitlementMock,
}))

vi.mock('@/lib/telemetry/usage', () => ({
  withApiUsage: () => (handler: (req: Request) => Promise<Response>) => handler,
}))

vi.mock('@/lib/ai-protection', () => ({
  checkAiRateLimit: checkAiRateLimitMock,
  getAiActionConfig: getAiActionConfigMock,
  getCachedResponse: getCachedResponseMock,
  setCachedResponse: setCachedResponseMock,
  buildCacheKey: buildCacheKeyMock,
  consumeRateLimit: vi.fn(),
}))

vi.mock('@/lib/trades/resolveTradeEvaluatorInternalLeagueId', () => ({
  resolveTradeEvaluatorInternalLeagueId: (...a: unknown[]) =>
    resolveTradeEvaluatorInternalLeagueIdMock(...a),
}))

vi.mock('@/lib/trades/tradePlayerIdentityResolver', () => ({
  resolveTradePlayerAssets: (...a: unknown[]) => resolveTradePlayerAssetsMock(...a),
}))

vi.mock('@/lib/trades/buildNormalizedTradeContext', () => ({
  buildNormalizedTradeContext: (...a: unknown[]) => buildNormalizedTradeContextMock(...a),
  buildNormalizedTradeEvidencePrompt: (...a: unknown[]) =>
    buildNormalizedTradeEvidencePromptMock(...a),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
  },
}))

vi.mock('@/lib/sleeper-client', () => ({
  getLeagueInfo: vi.fn().mockResolvedValue(null),
  getLeagueRosters: vi.fn().mockResolvedValue([]),
  getTradedDraftPicks: vi.fn().mockResolvedValue([]),
  getPlayersBySport: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/lib/deepseek-client', () => ({
  deepseekQuantAnalysis: vi.fn().mockResolvedValue({
    json: {
      fairnessScore: 55,
      netValueDelta: 0,
      projectionDeltaA: 0,
      projectionDeltaB: 0,
      expectedWeeklyGainA: 0,
      expectedWeeklyGainB: 0,
      playoffImpactA: 50,
      playoffImpactB: 50,
      riskGradeA: 'B',
      riskGradeB: 'B',
      ceilingA: 0,
      floorA: 0,
      ceilingB: 0,
      floorB: 0,
      varianceScore: 50,
      confidencePct: 60,
      winnerSide: 'even',
      quantReasoning: 'ok',
    },
    raw: '',
    error: null,
  }),
}))

vi.mock('@/lib/xai-client', () => ({
  xaiChatJson: vi.fn().mockResolvedValue({ ok: false }),
  parseTextFromXaiChatCompletion: vi.fn(),
}))

vi.mock('@/lib/openai-client', () => ({
  openaiChatJson: vi.fn().mockResolvedValue({ ok: false }),
  parseJsonContentFromChatCompletion: vi.fn(),
}))

vi.mock('@/lib/player-media', () => ({
  attachPlayerMediaBatch: vi.fn().mockResolvedValue(new Map()),
}))

vi.mock('@/lib/ai/output-logger', () => ({
  logAiOutput: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/ai/pecr', () => ({
  runPECR: vi.fn(async (input: { payload: Record<string, unknown> }) => ({
    output: input,
    iterations: 1,
    passed: true,
    feature: 'trade' as const,
    allFailures: [] as string[][],
    durationMs: 1,
  })),
}))

function baseBody() {
  return {
    trade_id: 't1',
    league_id: 'sleeper-league-1',
    sender: {
      manager_name: 'A',
      gives_players: [{ name: 'Player One', playerId: 'sp-1' }],
      gives_picks: [],
      gives_faab: 0,
    },
    receiver: {
      manager_name: 'B',
      gives_players: [{ name: 'Player Two' }],
      gives_picks: [],
      gives_faab: 0,
    },
    league: {
      format: 'dynasty',
      sport: 'NFL',
      qb_format: 'sf',
    },
  }
}

describe('POST /api/trade-evaluator normalized provider context', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isToolTradeAnalyzerEnabledMock.mockResolvedValue(true)
    getAiActionConfigMock.mockReturnValue({
      maxRequests: 50,
      windowMs: 60_000,
      cacheTtlMs: 0,
    })
    checkAiRateLimitMock.mockReturnValue({
      allowed: true,
      retryAfterSec: 0,
      remaining: 49,
    })
    getCachedResponseMock.mockReturnValue(null)
    buildCacheKeyMock.mockReturnValue('k')
    setCachedResponseMock.mockImplementation(() => {})
    getServerSessionMock.mockResolvedValue({ user: { id: 'user-1' } })
    requireFeatureEntitlementMock.mockResolvedValue({
      ok: true,
      decision: {},
      tokenSpend: null,
      tokenPreview: null,
    })
    assertLeagueMemberMock.mockResolvedValue(undefined)
    resolveTradeEvaluatorInternalLeagueIdMock.mockResolvedValue('af-league-1')
    buildNormalizedTradeEvidencePromptMock.mockReturnValue('MOCK_EVIDENCE_PROMPT')
  })

  it('includes providerEvidence summary when normalized context resolves', async () => {
    resolveTradePlayerAssetsMock.mockResolvedValue({
      resolved: [{ playerId: 'sp-1', originalAsset: {}, source: 'explicit_player_id' }],
      unresolved: [],
    })
    buildNormalizedTradeContextMock.mockResolvedValue({
      players: [{ name: 'P', adp: 1, aiAdp: 2, injuryStatus: 'Out' }],
      wireRows: [],
      unresolvedPlayers: [],
      summary: {
        totalAssets: 2,
        resolvedPlayers: 1,
        unresolvedPlayers: 0,
        fallbackSources: ['src-a'],
        missingDomains: [],
      },
    })

    const { POST } = await import('@/app/api/trade-evaluator/route')
    const res = await POST(
      createMockNextRequest('http://localhost/api/trade-evaluator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(baseBody()),
      }) as any,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.success).toBe(true)
    expect(body.valuationReport).toBeTruthy()
    expect(body.providerEvidence).toMatchObject({
      summary: expect.objectContaining({
        resolvedPlayers: 1,
        totalAssets: 2,
      }),
    })
    expect(buildNormalizedTradeContextMock).toHaveBeenCalled()
    expect(buildNormalizedTradeEvidencePromptMock).toHaveBeenCalled()
  })

  it('omits providerEvidence when no players resolve for normalized fetch', async () => {
    resolveTradePlayerAssetsMock.mockResolvedValue({
      resolved: [],
      unresolved: [{ originalAsset: { name: 'Player One' }, reason: 'sports_player_record_not_found' }],
    })

    const { POST } = await import('@/app/api/trade-evaluator/route')
    const res = await POST(
      createMockNextRequest('http://localhost/api/trade-evaluator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(baseBody()),
      }) as any,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.providerEvidence).toBeUndefined()
    expect(buildNormalizedTradeContextMock).not.toHaveBeenCalled()
  })
})
