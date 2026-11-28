// @vitest-environment node
/**
 * Owner's decision 2026-11-28, item D: every devy and C2C PLAYER-level action (advice to a manager about their
 * own roster) is Chimmy Intelligence (`af_intelligence`: AF Pro, AF Commissioner, AF Supreme) through
 * lib/subscription/memberPlayerAiGate.ts, plus the member daily cap. League-administration actions keep
 * `commissioner_ai_tools` (AF Commissioner, AF Supreme).
 *
 * Plans resolve through the REAL rules (tierMatrixHarness) and the REAL `requireEntitlement`; the cap through
 * the REAL `aiCostGate`. Only the plan's database read, the day counter and the model modules are replaced
 * (every export of each model module is a spy that records and rejects). Past the gate the league read
 * refuses, so an allowed tier stops visibly AFTER the gate and nothing here reaches a model.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TIERS, setTier, type Tier } from './tierMatrixHarness'

const { session, spend, daily } = vi.hoisted(() => ({ session: vi.fn(), spend: vi.fn(), daily: vi.fn() }))

vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => session(...a) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/subscription/EntitlementResolver', async () => (await import('./tierMatrixHarness')).resolverModule())
vi.mock('@/lib/rate-limit-daily', () => ({ consumeDailyLimit: (...a: unknown[]) => daily(...a) }))
vi.mock('@/lib/rate-limit', async (orig) => ({
  ...(await orig<typeof import('@/lib/rate-limit')>()),
  consumeRateLimit: () => ({ success: true, remaining: 99, retryAfterSec: 0, resetTimeMs: 0 }),
}))

const spyAll = async (load: () => Promise<Record<string, unknown>>) => {
  const mod = await load()
  return Object.fromEntries(
    Object.entries(mod).map(([k, v]) => [
      k,
      typeof v === 'function'
        ? (...a: unknown[]) => {
            spend(k, a)
            return Promise.reject(new Error('model must not run in this test'))
          }
        : v,
    ]),
  )
}
vi.mock('@/lib/devy/ai/devyChimmy', async (orig) => spyAll(orig as never))
vi.mock('@/lib/c2c/ai/c2cChimmy', async (orig) => spyAll(orig as never))
vi.mock('@/lib/openai-client', () => ({
  openaiChatText: (...a: unknown[]) => {
    spend('openaiChatText', a)
    return Promise.reject(new Error('no'))
  },
  openaiChatJson: (...a: unknown[]) => {
    spend('openaiChatJson', a)
    return Promise.reject(new Error('no'))
  },
  parseJsonContentFromChatCompletion: () => null,
}))
const dbProxy: unknown = new Proxy(() => undefined, {
  get: (_t, k) => (k === 'then' ? undefined : dbProxy),
  apply: () => Promise.reject(new Error('db not available in this test')),
})
vi.mock('@/lib/prisma', () => ({ prisma: dbProxy }))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: async () => ({ ok: false, status: 403 }) }))
vi.mock('@/lib/live-draft-engine/auth', () => ({ canAccessLeagueDraft: async () => true }))
vi.mock('@/lib/devy', () => ({ isDevyLeague: async () => true }))
vi.mock('@/lib/merged-devy-c2c/C2CLeagueConfig', () => ({ isC2CLeague: async () => true }))
vi.mock('@/lib/league/commissionerAccess', () => ({
  assertCommissionerAccess: async () => {
    throw new Error('not commissioner')
  },
  canCommissionerAct: async () => false,
}))

type Handler = (req: never, ctx?: never) => Promise<Response>
async function call(path: string, url: string, body: unknown, ctx?: unknown) {
  const mod = (await import(/* @vite-ignore */ path)) as Record<string, Handler>
  const request = new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify(body ?? {}),
  }) as never
  try {
    const res = await mod.POST!(request, ctx as never)
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    return { status: res.status, json }
  } catch (error) {
    return { status: 599, json: { error: String(error) } as Record<string, unknown> }
  }
}

const planRefused = (r: { status: number; json: Record<string, unknown> }) =>
  (r.status === 402 && r.json.upgrade === true) || (r.status === 403 && r.json.code === 'feature_not_entitled')

const AF_INTELLIGENCE: Tier[] = ['pro', 'commissioner', 'supreme']
const COMMISSIONER_SUPREME: Tier[] = ['commissioner', 'supreme']

type Row = { route: string; action: string; gate: 'member' | 'host'; body: Record<string, unknown>; path: string; url: string; ctx?: () => unknown }

const devy = (action: string, gate: Row['gate'], body: Record<string, unknown> = {}): Row => ({
  route: '/api/devy/ai', action, gate, path: '@/app/api/devy/ai/route', url: 'http://localhost/api/devy/ai',
  body: { action, leagueId: 'L1', ...body },
})
const c2c = (action: string, gate: Row['gate'], body: Record<string, unknown> = {}): Row => ({
  route: '/api/c2c/ai', action, gate, path: '@/app/api/c2c/ai/route', url: 'http://localhost/api/c2c/ai',
  body: { action, leagueId: 'L1', ...body },
})
const leagueCtx = () => ({ params: Promise.resolve({ leagueId: 'L1' }) })

/** The split, one row per action. This table is what the report lists. */
const ROWS: Row[] = [
  // /api/devy/ai — player level
  devy('prospect_eval', 'member', { playerId: 'p1' }),
  devy('pipeline_health', 'member'),
  devy('should_promote', 'member', { playerId: 'p1' }),
  devy('draft_advice', 'member'),
  devy('devy_rankings', 'member'),
  devy('breakout_alerts', 'member'),
  // /api/devy/ai — league administration
  devy('setup_recommendation', 'host'),
  devy('suggest_matches', 'host', { sessionId: 's1' }),
  devy('import_summary', 'host', { sessionId: 's1' }),
  devy('commissioner_chat', 'host', { message: 'hi' }),
  devy('constitution', 'host'),
  devy('annual_report', 'host', { season: 2026 }),
  // /api/c2c/ai — player level
  c2c('campus_eval', 'member', { playerId: 'p1' }),
  c2c('campus_rankings', 'member'),
  c2c('breakout_alerts', 'member'),
  c2c('roster_balance', 'member'),
  c2c('transition_advice', 'member', { playerId: 'p1' }),
  c2c('draft_advice', 'member'),
  // /api/c2c/ai — league administration
  c2c('setup_rec', 'host'),
  c2c('commissioner_chat', 'host', { message: 'hi' }),
  c2c('constitution', 'host'),
  c2c('weekly_recap', 'host', { week: 3 }),
  // The league-scoped routes: every type is player-level advice.
  ...['scout', 'promotion_advisor', 'draft_assistant', 'class_storytelling', 'trade_context', 'rookie_vs_devy_decision'].map(
    (type): Row => ({
      route: '/api/leagues/[leagueId]/devy/ai', action: type, gate: 'member', ctx: leagueCtx,
      path: '@/app/api/leagues/[leagueId]/devy/ai/route', url: 'http://localhost/api/leagues/L1/devy/ai',
      body: { type, devyPlayerId: 'd1', rosterId: 'r1', phase: 'startup', side: 'give', assets: [] },
    }),
  ),
  ...['pipeline_advisor', 'college_vs_rookie_decision', 'startup_draft_assistant', 'promotion_advisor', 'hybrid_strategy', 'trade_context'].map(
    (type): Row => ({
      route: '/api/leagues/[leagueId]/merged-devy-c2c/ai', action: type, gate: 'member', ctx: leagueCtx,
      path: '@/app/api/leagues/[leagueId]/merged-devy-c2c/ai/route', url: 'http://localhost/api/leagues/L1/merged-devy-c2c/ai',
      body: { type, rosterId: 'r1', phase: 'startup', side: 'give', assets: [] },
    }),
  ),
]

beforeEach(() => {
  session.mockReset()
  session.mockResolvedValue({ user: { id: 'u1', email: null } })
  spend.mockReset()
  daily.mockReset()
  daily.mockResolvedValue({ success: true, retryAfterSec: 0 })
})

describe('D. devy / C2C: player actions are Chimmy Intelligence, league administration stays AF Commissioner', () => {
  for (const row of ROWS) {
    const allowed = row.gate === 'member' ? AF_INTELLIGENCE : COMMISSIONER_SUPREME
    const featureId = row.gate === 'member' ? 'af_intelligence' : 'commissioner_ai_tools'
    for (const tier of TIERS) {
      const open = allowed.includes(tier)
      it(`${row.route} ${row.action} — ${tier}: ${open ? 'past the gate' : `locked on ${featureId}, nothing spent`}`, async () => {
        setTier(tier)
        const r = await call(row.path, row.url, row.body, row.ctx?.())
        expect(planRefused(r), JSON.stringify(r)).toBe(!open)
        if (!open) {
          if (r.status === 402) expect(r.json.featureId).toBe(featureId)
          expect(daily).not.toHaveBeenCalled()
        }
        if (!open) expect(spend).not.toHaveBeenCalled()
      })
    }
  }
})

describe('D. the member actions carry the daily cap; host tools are untouched by it', () => {
  for (const row of ROWS.filter((r) => r.gate === 'member')) {
    it(`${row.route} ${row.action}: AF Pro at the cap → 429, no model call`, async () => {
      setTier('pro')
      daily.mockResolvedValue({ success: false, retryAfterSec: 3600 })
      const r = await call(row.path, row.url, row.body, row.ctx?.())
      expect(r.status, JSON.stringify(r)).toBe(429)
      expect(r.json.code).toBe('daily_limit_reached')
      expect(spend).not.toHaveBeenCalled()
    })
  }

  it('signed out → 401 on a member action and a host action, nothing spent', async () => {
    session.mockResolvedValue(null)
    setTier('supreme')
    for (const row of [ROWS[1]!, ROWS[10]!, ROWS[ROWS.length - 1]!]) {
      const r = await call(row.path, row.url, row.body, row.ctx?.())
      expect(r.status).toBe(401)
    }
    expect(spend).not.toHaveBeenCalled()
  })

  it('an AF Commissioner host action never touches the member cap', async () => {
    setTier('commissioner')
    await call(ROWS[10]!.path, ROWS[10]!.url, ROWS[10]!.body)
    expect(daily).not.toHaveBeenCalled()
  })
})
