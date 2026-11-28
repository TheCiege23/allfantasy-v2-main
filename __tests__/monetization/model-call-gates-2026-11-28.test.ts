// @vitest-environment node
/**
 * Owner's decision 2026-11-28, item A: EVERY model call needs sign-in and a small daily cap, and the expensive
 * player tools also need AF Pro / AF Supreme.
 *
 * Each route is run through the REAL gates — `aiCostGate` (lib/ai-protection/costGate.ts) and
 * `requireFeatureEntitlement` — with the plan resolved by the REAL rules (tierMatrixHarness). Only the plan's
 * database read, the durable day counter (`consumeDailyLimit`), the per-minute burst limiter and the model
 * clients are replaced. Every model client is a spy that records the call and rejects, so "the model was
 * never called" is `spend` having zero calls.
 *
 *   signed out → 401, no model call
 *   capped     → 429 daily_limit_reached with a sentence saying when it resets, no model call
 *   under cap  → the model IS reached (so the gate is not simply refusing everything)
 *   locked plan (Pro routes) → 403 feature_not_entitled, no model call, cap never touched
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TIERS, setTier, type Tier } from './tierMatrixHarness'

const { session, spend, daily } = vi.hoisted(() => ({
  session: vi.fn(),
  spend: vi.fn(),
  daily: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => session(...a) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/telemetry/usage', () => ({ withApiUsage: () => (h: unknown) => h }))
vi.mock('@/lib/subscription/EntitlementResolver', async () => (await import('./tierMatrixHarness')).resolverModule())
vi.mock('@/lib/rate-limit-daily', () => ({ consumeDailyLimit: (...a: unknown[]) => daily(...a) }))
// The per-minute burst limiter is in-process; these tests call one route many times as one user.
vi.mock('@/lib/rate-limit', async (orig) => ({
  ...(await orig<typeof import('@/lib/rate-limit')>()),
  consumeRateLimit: () => ({ success: true, remaining: 99, retryAfterSec: 0, resetTimeMs: 0 }),
  rateLimit: () => ({ success: true, remaining: 99, retryAfterSec: 0, resetTimeMs: 0 }),
}))

// ── Every model client: recorded, never run. ─────────────────────────────────────────────────────────────
const reject = (...a: unknown[]) => {
  spend(a)
  return Promise.reject(new Error('model must not run in this test'))
}
const modelProxy: unknown = new Proxy(() => undefined, {
  get: () => modelProxy,
  apply: (_t, _this, args) => reject(...args),
})
vi.mock('@/lib/ai/openai-route-client', () => ({ getOpenAIRouteClient: () => modelProxy }))
vi.mock('@/lib/openai-client', () => ({
  openaiChatJson: reject,
  openaiChatText: reject,
  parseJsonContentFromChatCompletion: () => null,
  getOpenAIConfig: () => ({}),
  getOpenAIClient: () => modelProxy,
}))
vi.mock('openai', () => ({ default: class { chat = { completions: { create: reject } } } }))
vi.mock('@/lib/ai/league-settings-ai/claude', () => ({ callClaudeJson: reject }))
vi.mock('@/lib/ai-orchestration', () => ({ runUnifiedOrchestration: reject }))
vi.mock('@/lib/draft/ai-claude', () => ({ draftAiText: reject }))
vi.mock('@/lib/player-trend/TrendDetectionAI', () => ({ getTrendAIInsight: reject }))
vi.mock('@/lib/simulation-engine/MatchupSimulationInsightAI', () => ({ getMatchupSimulationInsight: reject }))

// ── The database: reads answer "nothing", overridable per test. ─────────────────────────────────────────
const db: Record<string, (args?: unknown) => unknown> = {}
const model = (name: string): unknown =>
  new Proxy(
    {},
    {
      get: (_t, method) => {
        if (method === 'then') return undefined
        return async (args?: unknown) => {
          const override = db[`${name}.${String(method)}`]
          if (override) return override(args)
          return String(method) === 'findMany' ? [] : String(method) === 'count' ? 0 : null
        }
      },
    },
  )
const prismaProxy: unknown = new Proxy({}, { get: (_t, k) => (k === 'then' ? undefined : model(String(k))) })
vi.mock('@/lib/prisma', () => ({ prisma: prismaProxy }))

// ── What each route reads BEFORE its gate, so the gate is what the test reaches. ──────────────────────────
vi.mock('@/lib/player-trend/TrendDetectionService', () => ({
  getTrendFeedItemForPlayer: async () => ({ playerId: 'p1', sport: 'NFL', trendType: 'hot_streak' }),
}))
vi.mock('@/lib/fantasycalc-db', () => ({
  readFantasyCalcValuesFromDb: async () => ({
    players: [
      {
        player: { id: 1, name: 'Bijan Robinson', position: 'RB', sleeperId: '9509', maybeTeam: 'ATL' },
        value: 8000,
        trend30Day: 2500,
        overallRank: 1,
        positionRank: 1,
        maybeMovingStandardDeviationPerc: 1,
      },
    ],
  }),
}))
vi.mock('@/lib/devy-intel', () => ({ computeAllDevyIntelMetrics: () => ({}) }))
vi.mock('@/lib/adp-data', () => ({ getPlayerADP: async () => null }))
vi.mock('@/lib/ai/league-settings-ai/access', () => ({
  assertLeagueAccess: async () => ({ id: 'L1', userId: 'u1', name: 'League', sport: 'NFL', settings: {} }),
  requireSleeper: () => null,
}))
vi.mock('@/lib/ai-result-cache', () => ({
  buildAiCacheKey: () => ({ resultKey: 'k', inputHash: 'h' }),
  readAiResultCache: async () => null,
  writeAiResultCache: async () => undefined,
  isAiResultCacheSmokeProviderEnabled: () => false,
  createSmokeAiResult: () => ({ text: '', json: {} }),
}))
vi.mock('@/lib/live-draft-engine/auth', () => ({ canAccessLeagueDraft: async () => true }))
vi.mock('@/lib/post-draft', () => ({
  buildDeterministicPostDraftRecap: async (leagueId: string) => ({
    leagueId,
    leagueName: 'League',
    sport: 'NFL',
    sections: { leagueNarrativeRecap: 'Recap.', teamGradeExplanations: [] },
  }),
}))
vi.mock('@/lib/provider-config', () => ({ getProviderStatus: () => ({ anyAi: true }) }))
vi.mock('@/lib/draft-automation-policy', () => ({
  buildDraftExecutionMetadata: () => ({}),
  evaluateAIInvocationPolicy: () => ({ decision: 'allow_ai', canShowAIButton: true, maxLatencyMs: 1000, reasonCode: 'ok' }),
  withTimeout: async (p: Promise<unknown>) => {
    try {
      return { ok: true, value: await p }
    } catch {
      return { ok: false }
    }
  },
}))
vi.mock('@/lib/merged-devy-c2c/C2CLeagueConfig', () => ({ isC2CLeague: async () => true }))
vi.mock('@/lib/merged-devy-c2c/ai/C2CAIContext', () => {
  const ctx = async () => ({ type: 'pipeline_advisor' })
  return {
    buildC2CPipelineAdvisorContext: ctx,
    buildC2CCollegeVsRookieContext: ctx,
    buildC2CStartupDraftAssistantContext: ctx,
    buildC2CPromotionAdvisorContext: ctx,
    buildC2CHybridStrategyContext: ctx,
    buildC2CTradeContextFromPayload: ctx,
  }
})
vi.mock('@/lib/merged-devy-c2c/ai/C2CAIPrompts', () => ({ buildC2CAIPrompt: () => ({ system: 's', user: 'u' }) }))
vi.mock('@/lib/time-engine/chimmyPromptPrefix', () => ({ withOfficialTimeUserMessage: async (_u: string, m: string) => m }))
vi.mock('@/lib/api/require-league-access', () => ({
  requireLeagueApiAccess: async (leagueId: string) => {
    const s = (await session()) as { user?: { id?: string } } | null
    if (!s?.user?.id) {
      const { NextResponse } = await import('next/server')
      return { ok: false, response: NextResponse.json({ error: 'anonymous' }, { status: 401 }) }
    }
    return { ok: true, leagueId, userId: s.user.id, access: 'member' }
  },
}))
vi.mock('@/lib/reputation-engine/ManagerTrustQueryService', () => ({
  getReputationByLeagueAndManager: async () => ({
    sport: 'NFL', season: 2026, tier: 'trusted', overallScore: 80, reliabilityScore: 80, activityScore: 80,
    tradeFairnessScore: 80, sportsmanshipScore: 80, commissionerTrustScore: 80, toxicityRiskScore: 10,
    participationQualityScore: 80, responsivenessScore: 80,
  }),
  listEvidenceForManager: async () => [],
}))
vi.mock('@/lib/legacy-score-engine/LegacyRankingService', () => ({
  getLegacyScoreByEntity: async () => ({ overallLegacyScore: 70 }),
}))
vi.mock('@/lib/legacy-score-engine/AILegacyExplanationService', () => ({
  buildLegacyExplanationContext: () => ({ breakdown: {} }),
  buildLegacyExplanationNarrative: () => 'Fallback.',
}))
vi.mock('@/lib/ai-tool-layer', () => ({
  buildEnvelopeForTool: () => ({}),
  formatToolResult: () => ({ output: {}, factGuardWarnings: [], sections: [] }),
  validateToolOutput: () => ({ warnings: [], errors: [] }),
}))
vi.mock('@/lib/auth-guard', async () => ({
  requireVerifiedUser: async () => {
    const s = (await session()) as { user?: { id?: string } } | null
    if (!s?.user?.id) {
      const { NextResponse } = await import('next/server')
      return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
    }
    return { ok: true, userId: s.user.id, profile: {} }
  },
}))
vi.mock('@/lib/brackets/getEntryBracketData', () => ({ getEntryBracketData: async () => ({ nodesWithGame: [] }) }))
vi.mock('@/lib/brackets/intelligence/data-engine', () => ({
  computePickDistribution: async () => new Map(),
  computeBracketUniqueness: () => ({ score: 50, percentile: 50 }),
}))
vi.mock('@/lib/draft/engineGroundingLoader', () => ({ loadDraftEngineGrounding: async () => null }))
vi.mock('@/lib/draft/ai-context', () => ({ buildDraftAiContext: async () => ({}), collectAiContextPlayerNames: () => [] }))
vi.mock('@/lib/legacy/requireLegacySleeperIdentity', () => ({
  requireLegacySleeperIdentity: async () => {
    const s = (await session()) as { user?: { id?: string } } | null
    if (!s?.user?.id) {
      const { NextResponse } = await import('next/server')
      return { ok: false, response: NextResponse.json({ error: 'Sign in' }, { status: 401 }) }
    }
    return { ok: true, identity: { sleeperUsername: 'sam', actorId: s.user.id, source: 'session' } }
  },
}))

// ── Harness ──────────────────────────────────────────────────────────────────────────────────────────────
type Handler = (req: never, ctx?: never) => Promise<Response>
type Row = {
  name: string
  path: string
  url: string
  body?: unknown
  method?: 'POST' | 'GET'
  ctx?: () => unknown
  /** Set up whatever the route reads before its model call. */
  before?: () => void
}

async function call(row: Row) {
  const mod = (await import(/* @vite-ignore */ row.path)) as Record<string, Handler>
  const method = row.method ?? 'POST'
  const req = new Request(row.url, {
    method,
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    ...(method === 'POST' ? { body: JSON.stringify(row.body ?? {}) } : {}),
  })
  try {
    const res = await mod[method](req as never, row.ctx?.() as never)
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    return { status: res.status, code: (json.code as string | undefined) ?? null, json }
  } catch (error) {
    return { status: 599, code: 'threw', json: { error: String(error) } as Record<string, unknown> }
  }
}

const leagueCtx = () => ({ params: Promise.resolve({ leagueId: 'L1' }) })

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k]
  session.mockReset()
  session.mockResolvedValue({ user: { id: 'u1', email: null } })
  spend.mockReset()
  daily.mockReset()
  daily.mockResolvedValue({ success: true, retryAfterSec: 0 })
  setTier('free')
})

/** Signed in, free or paid: sign-in plus a daily cap. */
const SIGNED_IN_CAPPED: Row[] = [
  {
    name: 'GET /api/player-trend/insight (DeepSeek + Grok + OpenAI)',
    path: '@/app/api/player-trend/insight/route',
    url: 'http://localhost/api/player-trend/insight?playerId=p1&sport=NFL',
    method: 'GET',
  },
  {
    name: 'POST /api/player-value',
    path: '@/app/api/player-value/route',
    url: 'http://localhost/api/player-value',
    body: { playerName: 'Bijan Robinson' },
  },
  {
    name: 'POST /api/ai-features',
    path: '@/app/api/ai-features/route',
    url: 'http://localhost/api/ai-features',
    body: { featureId: 'trade' },
  },
  {
    name: 'POST /api/legacy/ai-report',
    path: '@/server/api-route-modules/legacy/ai-report/route',
    url: 'http://localhost/api/legacy/ai-report',
    body: {},
    before: () => {
      db['league.findMany'] = async () => [{ name: 'L', season: 2026, isDynasty: true, scoring: 'ppr', teams: [] }]
    },
  },
  {
    name: 'POST /api/ai/commish-note',
    path: '@/app/api/ai/commish-note/route',
    url: 'http://localhost/api/ai/commish-note',
    body: { leagueId: 'L1' },
  },
  {
    name: 'POST /api/leagues/[leagueId]/draft/recap (includeAiExplanation)',
    path: '@/app/api/leagues/[leagueId]/draft/recap/route',
    url: 'http://localhost/api/leagues/L1/draft/recap',
    body: { includeAiExplanation: true },
    ctx: leagueCtx,
  },
  {
    name: 'POST /api/leagues/[leagueId]/reputation/explain',
    path: '@/app/api/leagues/[leagueId]/reputation/explain/route',
    url: 'http://localhost/api/leagues/L1/reputation/explain',
    body: { managerId: 'm1' },
    ctx: leagueCtx,
  },
  {
    name: 'POST /api/leagues/[leagueId]/legacy-score/explain',
    path: '@/app/api/leagues/[leagueId]/legacy-score/explain/route',
    url: 'http://localhost/api/leagues/L1/legacy-score/explain',
    body: { entityType: 'MANAGER', entityId: 'm1' },
    ctx: leagueCtx,
  },
  {
    name: 'POST /api/bracket/intelligence/review',
    path: '@/app/api/bracket/intelligence/review/route',
    url: 'http://localhost/api/bracket/intelligence/review',
    body: { entryId: 'e1' },
    before: () => {
      db['bracketEntry.findUnique'] = async () => ({ id: 'e1', userId: 'u1', league: { id: 'b1', tournamentId: 't1' }, picks: [] })
    },
  },
  {
    name: 'POST /api/simulation/matchup/insight',
    path: '@/app/api/simulation/matchup/insight/route',
    url: 'http://localhost/api/simulation/matchup/insight',
    body: { teamA: { mean: 110 }, teamB: { mean: 100 } },
  },
]

describe('A. signed-in model routes: sign-in, then a daily cap, before any model call', () => {
  for (const row of SIGNED_IN_CAPPED) {
    describe(row.name, () => {
      it('signed out → 401, the model is never called', async () => {
        row.before?.()
        session.mockResolvedValue(null)
        const r = await call(row)
        expect(r.status, JSON.stringify(r)).toBe(401)
        expect(spend).not.toHaveBeenCalled()
      })

      it('capped → 429 that says when it resets, the model is never called', async () => {
        row.before?.()
        daily.mockResolvedValue({ success: false, retryAfterSec: 3600 })
        const r = await call(row)
        expect(r.status, JSON.stringify(r)).toBe(429)
        expect(r.code).toBe('daily_limit_reached')
        expect(String(r.json.message)).toMatch(/resets at midnight UTC/)
        expect(spend).not.toHaveBeenCalled()
      })

      it('under the cap → the model is reached, and one call was counted', async () => {
        row.before?.()
        await call(row)
        expect(daily).toHaveBeenCalledTimes(1)
        expect(spend).toHaveBeenCalled()
      })
    })
  }

  it("a free account's 429 names the plan that raises the cap and links it (wait, or upgrade)", async () => {
    daily.mockResolvedValue({ success: false, retryAfterSec: 3600 })
    const r = await call(SIGNED_IN_CAPPED[0])
    expect(r.status).toBe(429)
    expect(String(r.json.message)).toMatch(/AF Pro/)
    expect(r.json.upgradePath).toBe('/upgrade?plan=pro')
  })
})

describe('A. /api/market-alerts: the signals stay public, only the model write-up is gated', () => {
  const row: Row = { name: 'market-alerts', path: '@/app/api/market-alerts/route', url: 'http://localhost/api/market-alerts?filter=nfl', method: 'GET' }

  it('signed out → 200 with the alerts and their deterministic headlines; the model is never called', async () => {
    session.mockResolvedValue(null)
    const r = await call(row)
    expect(r.status).toBe(200)
    expect((r.json.alerts as unknown[]).length).toBeGreaterThan(0)
    expect(r.json.narrativesWithheld).toMatchObject({ reason: 'sign_in' })
    expect(spend).not.toHaveBeenCalled()
  })

  it('signed in and capped → 200 with the alerts, the write-up withheld with a reset sentence; no model call', async () => {
    daily.mockResolvedValue({ success: false, retryAfterSec: 3600 })
    const r = await call(row)
    expect(r.status).toBe(200)
    expect(r.json.narrativesWithheld).toMatchObject({ reason: 'daily' })
    expect(String((r.json.narrativesWithheld as { message: string }).message)).toMatch(/midnight UTC/)
    expect(spend).not.toHaveBeenCalled()
  })

  it('signed in, under the cap → the model writes the headlines', async () => {
    const r = await call(row)
    expect(r.status).toBe(200)
    expect(r.json.narrativesWithheld).toBeUndefined()
    expect(spend).toHaveBeenCalledTimes(1)
  })
})

/** Expensive player tools: AF Pro / AF Supreme, then a cap. */
const PRO_SUPREME: Tier[] = ['pro', 'supreme']
const DRAFT_AI = ['best-pick', 'compare', 'grade', 'scarcity', 'queue-suggestions', 'roster-fit', 'pick-survival', 'draft-recap']
const PRO_ROWS: Row[] = [
  ...DRAFT_AI.map((name) => ({
    name: `POST /api/draft/ai/${name}`,
    path: `@/app/api/draft/ai/${name}/route`,
    url: `http://localhost/api/draft/ai/${name}`,
    body: { sessionId: 's1' },
  })),
  {
    name: 'POST /api/legacy/player-finder',
    path: '@/server/api-route-modules/legacy/player-finder/route',
    url: 'http://localhost/api/legacy/player-finder',
    body: { query: 'Bijan', sport: 'nfl' },
  },
]

describe('A. expensive player tools: AF Pro / AF Supreme, then a daily cap', () => {
  for (const row of PRO_ROWS) {
    describe(row.name, () => {
      it('signed out → 401, no model call', async () => {
        session.mockResolvedValue(null)
        setTier('supreme')
        const r = await call(row)
        expect(r.status).toBe(401)
        expect(spend).not.toHaveBeenCalled()
      })

      for (const tier of TIERS) {
        const open = PRO_SUPREME.includes(tier)
        it(`${tier}: ${open ? 'past the plan gate' : '403 feature_not_entitled — the cap and the model are never touched'}`, async () => {
          setTier(tier)
          const r = await call(row)
          if (open) {
            expect(r.code, JSON.stringify(r)).not.toBe('feature_not_entitled')
            expect(r.status).not.toBe(429)
            expect(daily).toHaveBeenCalledTimes(1)
          } else {
            expect(r.status, JSON.stringify(r)).toBe(403)
            expect(r.code).toBe('feature_not_entitled')
            expect(String(r.json.upgradePath ?? '')).toMatch(/^\//)
            expect(daily).not.toHaveBeenCalled()
            expect(spend).not.toHaveBeenCalled()
          }
        })
      }

      it('AF Pro at the cap → 429, no model call', async () => {
        setTier('pro')
        daily.mockResolvedValue({ success: false, retryAfterSec: 3600 })
        const r = await call(row)
        expect(r.status).toBe(429)
        expect(r.code).toBe('daily_limit_reached')
        expect(spend).not.toHaveBeenCalled()
      })
    })
  }

  it('the draft tools reach the model for AF Pro (compare, grade, draft-recap call it directly)', async () => {
    setTier('pro')
    for (const name of ['compare', 'grade', 'draft-recap']) {
      spend.mockReset()
      await call(PRO_ROWS.find((r) => r.name.endsWith(`/${name}`))!)
      expect(spend, name).toHaveBeenCalledTimes(1)
    }
  })
})

describe('A. /api/leagues/[leagueId]/merged-devy-c2c/ai: sign-in, plan and cap before the model (D moves the plan to Chimmy Intelligence)', () => {
  const row: Row = {
    name: 'merged-devy-c2c ai',
    path: '@/app/api/leagues/[leagueId]/merged-devy-c2c/ai/route',
    url: 'http://localhost/api/leagues/L1/merged-devy-c2c/ai',
    body: { type: 'pipeline_advisor', rosterId: 'r1' },
    ctx: leagueCtx,
  }

  it('signed out → 401, no model call', async () => {
    session.mockResolvedValue(null)
    const r = await call(row)
    expect(r.status).toBe(401)
    expect(spend).not.toHaveBeenCalled()
  })

  it('capped → 429, no model call', async () => {
    setTier('supreme')
    daily.mockResolvedValue({ success: false, retryAfterSec: 3600 })
    const r = await call(row)
    expect(r.status).toBe(429)
    expect(spend).not.toHaveBeenCalled()
  })

  it('under the cap → the model is reached', async () => {
    setTier('supreme')
    await call(row)
    expect(spend).toHaveBeenCalledTimes(1)
  })
})

describe('A. /api/league/quick-create had no caller and is deleted, not gated', () => {
  it('the route module is gone', async () => {
    await expect(import(/* @vite-ignore */ '@/app/api/league/quick-create/route')).rejects.toThrow()
  })
})
