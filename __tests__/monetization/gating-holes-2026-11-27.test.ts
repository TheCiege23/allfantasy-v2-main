// @vitest-environment node
/**
 * The gating holes closed on 2026-11-27 (owner's decisions; gating audit H1–H6 + trash talk), each run
 * against all five customer tiers. Plans resolve through the REAL rules (tierMatrixHarness) and the REAL
 * `requireFeatureEntitlement` / `FeatureGateService`; only the database read of the plan is replaced.
 *
 * Every row asserts BOTH directions: the tiers the owner named get past the gate, every other tier is
 * refused with `feature_not_entitled` and nothing is spent — no model call.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TIERS, setTier, type Tier } from './tierMatrixHarness'

const session = vi.fn()
vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => session(...a) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/telemetry/usage', () => ({ withApiUsage: () => (h: unknown) => h }))
vi.mock('@/lib/subscription/EntitlementResolver', async () => (await import('./tierMatrixHarness')).resolverModule())

// Anything that would spend: the model clients. Recorded, never run.
const spend = vi.fn()
const modelProxy: unknown = new Proxy(() => undefined, {
  get: () => modelProxy,
  apply: (_t, _this, args) => {
    spend(args)
    return Promise.reject(new Error('model must not run in this test'))
  },
})
vi.mock('@/lib/ai/openai-route-client', () => ({ getOpenAIRouteClient: () => modelProxy }))
vi.mock('@/lib/openai-client', () => ({
  openaiChatJson: (...a: unknown[]) => { spend(a); return Promise.reject(new Error('model must not run')) },
  openaiChatText: (...a: unknown[]) => { spend(a); return Promise.reject(new Error('model must not run')) },
  parseJsonContentFromChatCompletion: () => null,
  getOpenAIConfig: () => ({}),
  getOpenAIClient: () => modelProxy,
}))
vi.mock('openai', () => ({ default: class { chat = { completions: { create: (...a: unknown[]) => { spend(a); return Promise.reject(new Error('no')) } } } } }))
vi.mock('@/lib/ai/league-settings-ai/claude', () => ({ callClaudeJson: (...a: unknown[]) => { spend(a); return Promise.reject(new Error('no')) } }))
vi.mock('@/lib/ai-orchestration', () => ({ runUnifiedOrchestration: (...a: unknown[]) => { spend(a); return Promise.reject(new Error('no')) } }))
// The database: every read rejects, so a route that gets PAST its gate fails later in a way that is
// visibly not the gate (a 4xx/5xx without `feature_not_entitled`).
const dbProxy: unknown = new Proxy(() => undefined, {
  get: (_t, k) => (k === 'then' ? undefined : dbProxy),
  apply: () => Promise.reject(new Error('db not available in this test')),
})
vi.mock('@/lib/prisma', () => ({ prisma: dbProxy }))
vi.mock('@/lib/legacy/sleeper-boundary', () => ({ assertSleeperBoundaryForLeagueId: async () => ({ ok: true }) }))
vi.mock('@/lib/api-auth', async (orig) => ({ ...(await orig<typeof import('@/lib/api-auth')>()), validateRequestOrigin: () => true }))
vi.mock('@/lib/injuries/injuryReadPort', () => ({ listInjuryFacts: async () => [] }))
vi.mock('@/lib/league/commissionerAccess', () => ({ assertCommissionerAccess: async () => undefined }))

// The one completed-trade grade, graded, so the trade-history prose step is reached.
const gradedView = {
  graded: true, letter: 'B', partnerLetter: 'C', percentDiff: 4, label: 'Slight win', sideAdvantage: 'you',
  action: 'accept', recommendation: 'Fair for you.', giveValue: 5000, getValue: 5400, giveMarket: 5000,
  getMarket: 5400, basis: 'Dynasty', scoringApplied: true, needApplied: false, needGap: null, lines: [], moves: [], current: null,
}
vi.mock('@/lib/legacy/legacyCompletedTradeGrades', () => ({
  gradeLegacyCompletedTrades: async ({ trades }: { trades: unknown[] }) => trades.map(() => ({ graded: false, reason: 'test' })),
}))

type Handler = (req: never, ctx?: never) => Promise<Response>
const load = async (path: string, method: 'POST' | 'GET' = 'POST'): Promise<Handler> =>
  ((await import(/* @vite-ignore */ path)) as Record<string, Handler>)[method]

const req = (url: string, body?: unknown, method: 'POST' | 'GET' = 'POST') =>
  new Request(url, {
    method,
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
  }) as never

async function call(path: string, url: string, body: unknown, method: 'POST' | 'GET' = 'POST', ctx?: unknown) {
  const handler = await load(path, method)
  try {
    const res = await handler(req(url, body, method), ctx as never)
    const json = (await res.json().catch(() => ({}))) as { code?: string }
    return { status: res.status, code: json.code ?? null, json }
  } catch (error) {
    // Thrown past the gate (the database is not there): that is "got past the gate".
    return { status: 599, code: 'threw', json: { error: String(error) } }
  }
}

const locked = (r: { status: number; code: string | null }) => r.status === 403 && r.code === 'feature_not_entitled'

beforeEach(() => {
  session.mockReset()
  session.mockResolvedValue({ user: { id: 'u1', email: null } })
  spend.mockReset()
})

type Row = {
  name: string
  path: string
  url: string
  body: unknown
  method?: 'POST' | 'GET'
  ctx?: unknown
  /** The tiers the owner's rule opens. */
  allowed: Tier[]
}

// AF Supreme includes AF Legacy since 2026-11-27 (commit 3 of that day); before it, this row read ['legacy'].
const LEGACY_ONLY: Tier[] = ['legacy', 'supreme']
const PRO_SUPREME: Tier[] = ['pro', 'supreme']
const COMMISSIONER_SUPREME: Tier[] = ['commissioner', 'supreme']

const ROWS: Row[] = [
  { name: 'AF Legacy trade alternatives', path: '@/server/api-route-modules/legacy/trade-alternatives/route', url: 'http://localhost/api/legacy/trade-alternatives', body: { userId: 'sam' }, allowed: LEGACY_ONLY },
  { name: 'AF Legacy devy board', path: '@/server/api-route-modules/legacy/devy-board/route', url: 'http://localhost/api/legacy/devy-board', body: {}, allowed: LEGACY_ONLY },
  { name: 'AF Legacy news summary', path: '@/server/api-route-modules/legacy/community-insights/route', url: 'http://localhost/api/legacy/community-insights?summarize=true', body: undefined, method: 'GET', allowed: LEGACY_ONLY },
  { name: 'waiver AI twin /api/waiver-ai-suggest', path: '@/app/api/waiver-ai-suggest/route', url: 'http://localhost/api/waiver-ai-suggest', body: {}, allowed: PRO_SUPREME },
  { name: 'waiver AI twin /api/waiver-ai/grok', path: '@/app/api/waiver-ai/grok/route', url: 'http://localhost/api/waiver-ai/grok', body: {}, allowed: PRO_SUPREME },
  { name: '/api/season-strategy (twin of legacy planning_tools)', path: '@/app/api/season-strategy/route', url: 'http://localhost/api/season-strategy', body: {}, allowed: PRO_SUPREME },
  { name: '/api/dynasty-outlook (twin of /api/dynasty-intelligence)', path: '@/app/api/dynasty-outlook/route', url: 'http://localhost/api/dynasty-outlook', body: {}, allowed: LEGACY_ONLY },
  {
    name: 'AI Commissioner "Chimmy explain"',
    path: '@/app/api/leagues/[leagueId]/ai-commissioner/explain/route',
    url: 'http://localhost/api/leagues/L1/ai-commissioner/explain',
    body: {},
    ctx: { params: Promise.resolve({ leagueId: 'L1' }) },
    allowed: COMMISSIONER_SUPREME,
  },
]

describe('each closed hole opens for exactly the tiers the owner named', () => {
  for (const row of ROWS) {
    for (const tier of TIERS) {
      const open = row.allowed.includes(tier)
      it(`${row.name} — ${tier}: ${open ? 'past the gate' : 'locked (403), nothing spent'}`, async () => {
        setTier(tier)
        const r = await call(row.path, row.url, row.body, row.method, row.ctx)
        expect(locked(r), JSON.stringify(r)).toBe(!open)
        if (!open) expect(spend).not.toHaveBeenCalled()
      })
    }
  }
})

describe('the AF Legacy routes that took anonymous callers now ask for sign-in first', () => {
  const SIGNED_OUT: Array<[string, string, string, unknown, ('POST' | 'GET')?]> = [
    ['trade-history grade', '@/server/api-route-modules/legacy/trade-history/route', 'http://localhost/api/legacy/trade-history', { leagueId: 'L1', userId: 'sam', action: 'grade', trade: { parties: [] } }],
    ['trade-alternatives', '@/server/api-route-modules/legacy/trade-alternatives/route', 'http://localhost/api/legacy/trade-alternatives', { userId: 'sam' }],
    ['devy-board', '@/server/api-route-modules/legacy/devy-board/route', 'http://localhost/api/legacy/devy-board', { league_id: 'L1' }],
    ['transfer', '@/server/api-route-modules/legacy/transfer/route', 'http://localhost/api/legacy/transfer', { leagueId: 'L1' }],
    ['community-insights summary', '@/server/api-route-modules/legacy/community-insights/route', 'http://localhost/api/legacy/community-insights?summarize=true', undefined, 'GET'],
  ]
  for (const [name, path, url, body, method] of SIGNED_OUT) {
    it(`${name}: 401 sign_in_required, no model call`, async () => {
      session.mockResolvedValue(null)
      setTier('legacy')
      const r = await call(path, url, body, method)
      expect(r.status).toBe(401)
      expect(r.code).toBe('sign_in_required')
      expect(spend).not.toHaveBeenCalled()
    })
  }
})

describe('trade-history `grade`: the letter stays free to a signed-in user; the prose is AF Legacy', () => {
  it('free → graded answer, writeUpLocked, no model call', async () => {
    const mod = await import('@/lib/legacy/legacyCompletedTradeGrades')
    vi.spyOn(mod, 'gradeLegacyCompletedTrades').mockResolvedValue([gradedView] as never)
    for (const tier of ['free', 'pro', 'commissioner'] as const) {
      setTier(tier)
      spend.mockReset()
      const r = await call('@/server/api-route-modules/legacy/trade-history/route', 'http://localhost/api/legacy/trade-history', {
        leagueId: 'L1', userId: 'sam', action: 'grade', trade: { transactionId: 't', parties: [{ userId: 'sam', displayName: 'Sam' }, { userId: 'kim', displayName: 'Kim' }] },
      })
      expect(r.status).toBe(200)
      expect((r.json as { writeUpLocked?: boolean }).writeUpLocked).toBe(true)
      expect((r.json as { gradedTrade?: { grade?: string; briefExplanation?: string } }).gradedTrade).toMatchObject({ grade: 'B', briefExplanation: 'Slight win' })
      expect(spend).not.toHaveBeenCalled()
    }
  })

  it('AF Legacy → the model writes the prose (it fails here, so the grade keeps its own words)', async () => {
    const mod = await import('@/lib/legacy/legacyCompletedTradeGrades')
    vi.spyOn(mod, 'gradeLegacyCompletedTrades').mockResolvedValue([gradedView] as never)
    setTier('legacy')
    const r = await call('@/server/api-route-modules/legacy/trade-history/route', 'http://localhost/api/legacy/trade-history', {
      leagueId: 'L1', userId: 'sam', action: 'grade', trade: { transactionId: 't', parties: [{ userId: 'sam', displayName: 'Sam' }, { userId: 'kim', displayName: 'Kim' }] },
    })
    expect(r.status).toBe(200)
    expect((r.json as { writeUpLocked?: boolean }).writeUpLocked).toBe(false)
    expect(spend).toHaveBeenCalledTimes(1)
  })
})

describe('trash talk is free and capped, not on the start/sit plan', () => {
  for (const tier of TIERS) {
    it(`${tier}: never locked`, async () => {
      setTier(tier)
      const r = await call('@/app/api/ai/trash-talk/route', 'http://localhost/api/ai/trash-talk', {})
      expect(locked(r)).toBe(false)
      expect(r.status).toBe(400) // past every gate, refused only for the missing target name
    })
  }

  it('the League Settings panel no longer maps it to a paid key', async () => {
    const { LEAGUE_SETTINGS_AI_PANEL_FEATURE } = await import('@/lib/monetization/entitlements')
    expect(LEAGUE_SETTINGS_AI_PANEL_FEATURE['ai-trash']).toBeUndefined()
    const { AI_COST_GATES } = await import('@/lib/ai-protection/costGate')
    expect(AI_COST_GATES.trash_talk).toMatchObject({ paidFromLaunch: false })
    expect('featureId' in AI_COST_GATES.trash_talk).toBe(false)
  })
})

describe('the dead anonymous /api/trade-partner route is gone', () => {
  it('has no route file', async () => {
    const { existsSync } = await import('node:fs')
    expect(existsSync('app/api/trade-partner/route.ts')).toBe(false)
  })
})
