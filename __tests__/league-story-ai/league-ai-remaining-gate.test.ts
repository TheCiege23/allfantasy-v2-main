// @vitest-environment node
/**
 * 🛑 OWNER'S DECISION (2026-11-27, follow-up to #4329): the remaining ungated league AI takes the same rule as
 * the league write-ups. The model runs only when the league's COMMISSIONER holds AF Commissioner or AF
 * Supreme — then every member gets it — with a per-league daily cap:
 *
 *   POST /relationship-insights/explain   relationship_explain  10   (had no plan and no cap)
 *   POST /graph-insight  (every type)     graph_insight         20   (had no plan, no cap, no membership)
 *   POST /drama/tell-story                drama                 10   (was per-CALLER with a token fallback)
 *
 * Each already had a fact-built version, so locked or capped serves THAT with `aiLocked` (200), never a model
 * call. Same harness as league-story-ai-gate.test.ts: real routes, model mocked at its call site, the plan
 * decided by the REAL plan maths (`hasFeatureAccessForPlans`), and an in-memory `consumeDailyLimit` that
 * honours `callsLimit`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  session: { user: { id: 'member-u' } } as { user: { id: string } } | null,
  commissioner: 'comm-c' as string | null,
  counters: new Map<string, number>(),
  counterCalls: [] as Array<{ provider: string; endpoint: string; callsLimit?: number }>,
  orchestrate: vi.fn(),
  openaiChatText: vi.fn(),
  tokenGate: vi.fn(),
  member: true,
}))

const PLANS: Record<string, string[]> = {
  'free-c': [],
  'pro-c': ['pro'],
  'comm-c': ['commissioner'],
  'sup-c': ['supreme'],
  'member-u': [],
}

vi.mock('next-auth', () => ({ getServerSession: async () => h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

vi.mock('@/lib/subscription/FeatureGateService', async () => {
  const fa = await vi.importActual<typeof import('@/lib/subscription/feature-access')>('@/lib/subscription/feature-access')
  class FeatureGateService {
    async evaluateUserFeatureAccess(userId: string, featureId: string) {
      const plans = (PLANS[userId] ?? []) as never[]
      const allowed = fa.hasFeatureAccessForPlans(plans, plans.length ? 'active' : 'none', featureId as never)
      return { allowed, featureId, requiredPlan: 'AF Commissioner', upgradePath: '/pricing', message: allowed ? 'ok' : 'locked' }
    }
  }
  return { FeatureGateService }
})

// The old per-caller token gate: drama must never reach it again.
vi.mock('@/lib/subscription/entitlement-middleware', () => ({ requireFeatureEntitlement: h.tokenGate }))

vi.mock('@/lib/rate-limit-daily', () => ({
  consumeDailyLimit: async (args: { provider: string; endpoint: string; callsLimit?: number }) => {
    h.counterCalls.push(args)
    const key = `${args.provider}|${args.endpoint}`
    const used = h.counters.get(key) ?? 0
    if (used >= (args.callsLimit ?? 1)) return { success: false, retryAfterSec: 3600 }
    h.counters.set(key, used + 1)
    return { success: true, retryAfterSec: 0 }
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { league: { findUnique: async () => ({ userId: h.commissioner }) } },
}))

vi.mock('@/lib/api/require-league-access', () => ({
  requireLeagueApiAccess: async () =>
    h.member
      ? { ok: true, leagueId: 'L1', userId: h.session?.user.id ?? 'x', access: {} }
      : { ok: false, response: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }) },
}))
vi.mock('@/lib/league-access', () => ({
  assertLeagueMember: async () => {
    if (!h.member) throw new Error('not a member')
    return { leagueSport: 'NFL' }
  },
}))

// ── Model call sites ─────────────────────────────────────────────────────────────────────────────────
vi.mock('@/lib/ai-orchestration', () => ({ runUnifiedOrchestration: h.orchestrate }))
// drama runs the REAL AIDramaNarrativeAdapter, so its model call is openaiChatText.
vi.mock('@/lib/openai-client', () => ({ openaiChatText: h.openaiChatText }))
vi.mock('@/lib/ai-tool-layer', () => ({
  buildEnvelopeForTool: () => ({}),
  formatToolResult: () => ({ output: { narrative: 'AI WRITE-UP', verdict: 'v' }, factGuardWarnings: [], sections: [] }),
  validateToolOutput: () => ({ warnings: [], errors: [] }),
}))

// ── Facts ────────────────────────────────────────────────────────────────────────────────────────────
vi.mock('@/lib/relationship-insights', () => ({
  buildAIRelationshipContext: async () => ({
    payload: { sportLabel: 'Football', storylines: [{ headline: 'Hawks vs Owls', storylineScore: 88 }] },
    promptContext: 'ctx',
  }),
}))
vi.mock('@/lib/relationship-insights/SportRelationshipResolver', () => ({
  normalizeOptionalSportForRelationship: () => 'NFL',
}))
vi.mock('@/lib/league-intelligence-graph', () => ({
  normalizeSportForGraph: () => 'NFL',
  buildLeagueRelationshipProfile: async () => ({
    season: 2026,
    strongestRivalries: [{ nodeA: 'a', nodeB: 'b', intensityScore: 0.9 }],
    tradeClusters: [],
    influenceLeaders: [],
    centralManagers: [],
    isolatedManagers: [],
    dynastyPowerTransitions: [],
  }),
}))
vi.mock('@/lib/prestige-governance/AIPrestigeContextResolver', () => ({ buildAIPrestigeContext: async () => null }))
const EVENT = {
  id: 'd1', leagueId: 'L1', sport: 'NFL', season: 2026, headline: 'The Week 9 Heist', summary: 'A 0.4-point win.',
  dramaType: 'upset', dramaScore: 80, relatedManagerIds: ['m1'], relatedTeamIds: [], relatedMatchupId: null,
}
vi.mock('@/lib/drama-engine/DramaQueryService', () => ({
  getDramaEventById: async (id: string) => (id === 'd1' ? EVENT : null),
}))

import { POST as relationshipExplain } from '@/app/api/leagues/[leagueId]/relationship-insights/explain/route'
import { POST as graphInsight } from '@/app/api/leagues/[leagueId]/graph-insight/handler'
import { POST as dramaTellStory } from '@/app/api/leagues/[leagueId]/drama/tell-story/route'

const ctx = { params: Promise.resolve({ leagueId: 'L1' }) }
const req = (body: unknown) =>
  new Request('http://localhost/x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

type Entry = {
  name: string
  kind: 'relationship_explain' | 'graph_insight' | 'drama'
  limit: number
  call: (body?: Record<string, unknown>) => Promise<Response>
  model: () => ReturnType<typeof vi.fn>
  /** The narrative the route returns, AI or fact-built. */
  text: (body: Record<string, unknown>) => unknown
}

const ENTRIES: Entry[] = [
  { name: 'POST /relationship-insights/explain', kind: 'relationship_explain', limit: 10,
    call: (b = {}) => relationshipExplain(req({ ...b }), ctx), model: () => h.orchestrate, text: (b) => b.narrative },
  // Every graph-insight type is the same consensus call; summary and rivalry are both driven.
  { name: 'POST /graph-insight (summary)', kind: 'graph_insight', limit: 20,
    call: (b = {}) => graphInsight(req({ type: 'summary', ...b }) as never, ctx), model: () => h.orchestrate,
    text: (b) => b.readableSummary },
  { name: 'POST /graph-insight (rivalry)', kind: 'graph_insight', limit: 20,
    call: (b = {}) => graphInsight(req({ type: 'rivalry', focusEntityId: 'RIVAL_OF:a:b', ...b }) as never, ctx),
    model: () => h.orchestrate, text: (b) => b.readableSummary },
  { name: 'POST /drama/tell-story', kind: 'drama', limit: 10,
    call: (b = {}) => dramaTellStory(req({ eventId: 'd1', ...b }), ctx), model: () => h.openaiChatText, text: (b) => b.narrative },
]

beforeEach(() => {
  h.session = { user: { id: 'member-u' } }
  h.commissioner = 'comm-c'
  h.member = true
  h.counters.clear()
  h.counterCalls.length = 0
  h.orchestrate.mockReset().mockResolvedValue({
    ok: true,
    response: { primaryAnswer: 'AI WRITE-UP', modelOutputs: [{ model: 'openai', raw: 'AI WRITE-UP' }] },
  })
  h.openaiChatText.mockReset().mockResolvedValue({ ok: true, text: 'AI WRITE-UP' })
  h.tokenGate.mockReset().mockResolvedValue({ ok: true, decision: {}, tokenSpend: null })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe.each(ENTRIES)('$name', (entry) => {
  it.each(['free-c', 'pro-c'])("a %s commissioner's league: no model call, the fact-built version with aiLocked", async (commish) => {
    h.commissioner = commish
    const res = await entry.call()
    const body = await res.json()
    expect(entry.model()).not.toHaveBeenCalled()
    expect(res.status).toBe(200)
    expect(body.source).toBe('template')
    expect(body.aiLocked).toMatchObject({
      code: 'feature_not_entitled',
      requiredPlan: 'AF Commissioner',
      featureId: 'storyline_creation',
      gatedBy: 'league_commissioner_plan',
    })
    expect(entry.text(body)).not.toContain('AI WRITE-UP')
    // A locked league never touches the counter.
    expect(h.counterCalls).toHaveLength(0)
  })

  it('a league with no commissioner on record is locked too (fails closed)', async () => {
    h.commissioner = null
    await entry.call()
    expect(entry.model()).not.toHaveBeenCalled()
  })

  it.each(['comm-c', 'sup-c'])("an %s commissioner's league gets the model write-up (200)", async (commish) => {
    h.commissioner = commish
    const res = await entry.call()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(entry.model()).toHaveBeenCalledTimes(1)
    expect(body.aiLocked).toBeNull()
    expect(body.source).toBe('ai')
    expect(entry.text(body)).toBe('AI WRITE-UP')
    expect(h.counterCalls[0]).toMatchObject({ provider: 'league_story_ai', endpoint: `${entry.kind}:L1`, callsLimit: entry.limit })
  })

  it("a member with no plan of their own, in an entitled league, gets it (200) — the commissioner's plan decides", async () => {
    h.session = { user: { id: 'member-u' } }
    h.commissioner = 'sup-c'
    const res = await entry.call()
    expect(res.status).toBe(200)
    expect(entry.model()).toHaveBeenCalledTimes(1)
  })

  it('a non-member is refused before any model call or counter', async () => {
    h.member = false
    const res = await entry.call()
    expect(res.status).toBe(403)
    expect(entry.model()).not.toHaveBeenCalled()
    expect(h.counterCalls).toHaveLength(0)
  })

  it('the daily cap is enforced at the limit for the league, then the fact-built version is served', async () => {
    for (let i = 0; i < entry.limit; i++) {
      expect((await (await entry.call()).json()).source).toBe('ai')
    }
    const res = await entry.call()
    const body = await res.json()
    expect(entry.model()).toHaveBeenCalledTimes(entry.limit)
    expect(res.status).toBe(200)
    expect(body.source).toBe('template')
    expect(body.aiLocked).toMatchObject({ code: 'daily_limit_reached', limit: entry.limit, retryAfterSec: 3600 })
  })

  it('Spanish copy when asked', async () => {
    h.commissioner = 'free-c'
    const body = await (await entry.call({ lang: 'es' })).json()
    expect(String(body.aiLocked.message)).toContain('comisionado')
    expect(String(body.aiLocked.message)).toContain('AF Commissioner')
  })

  it('Spanish copy for the cap too', async () => {
    for (let i = 0; i < entry.limit; i++) await entry.call()
    const body = await (await entry.call({ lang: 'es' })).json()
    expect(String(body.aiLocked.message)).toContain(`${entry.limit}`)
    expect(String(body.aiLocked.message)).toMatch(/medianoche UTC/)
  })
})

describe('the fact-built version is served when locked', () => {
  beforeEach(() => {
    h.commissioner = 'free-c'
  })

  it("relationship explain: the template from the league's top storyline", async () => {
    const body = await (await relationshipExplain(req({}), ctx)).json()
    expect(body.narrative).toContain('Hawks vs Owls currently leads the Football storyline board')
  })

  it("graph insight: the graph summary from the profile's facts, and no per-model fields", async () => {
    const body = await (await graphInsight(req({ type: 'summary' }) as never, ctx)).json()
    expect(body.readableSummary).toBe('League graph summary: Strong rivalries: 1 pairs.')
    expect(body.metricsInterpretation).toBeNull()
    expect(body.momentumStoryline).toBeNull()
  })

  it("drama: the template narrative from the event's own facts", async () => {
    const body = await (await dramaTellStory(req({ eventId: 'd1' }), ctx)).json()
    expect(body.narrative).toContain('The Week 9 Heist')
    expect(body.narrative).toContain('Drama score: 80/100.')
    expect(body).toMatchObject({ eventId: 'd1', headline: 'The Week 9 Heist', source: 'template' })
  })
})

describe('drama/tell-story left token billing (owner, 2026-11-27)', () => {
  it('the caller-billed token gate is never asked, locked or entitled, confirmed or not', async () => {
    h.commissioner = 'free-c'
    await dramaTellStory(req({ eventId: 'd1', confirmTokenSpend: true }), ctx)
    h.commissioner = 'comm-c'
    const res = await dramaTellStory(req({ eventId: 'd1', confirmTokenSpend: true }), ctx)
    const body = await res.json()
    expect(h.tokenGate).not.toHaveBeenCalled()
    expect(body).not.toHaveProperty('tokenSpend')
  })

  it('a bad request costs no cap: a missing or foreign eventId is refused before the counter', async () => {
    expect((await dramaTellStory(req({}), ctx)).status).toBe(400)
    expect((await dramaTellStory(req({ eventId: 'other' }), ctx)).status).toBe(404)
    expect(h.counterCalls).toHaveLength(0)
    expect(h.openaiChatText).not.toHaveBeenCalled()
  })
})

describe('caps are per kind and per league', () => {
  it('twenty graph insights leave the relationship and drama allowances untouched', async () => {
    for (let i = 0; i < 20; i++) await graphInsight(req({ type: 'summary' }) as never, ctx)
    expect((await (await graphInsight(req({ type: 'manager' }) as never, ctx)).json()).aiLocked).toMatchObject({
      code: 'daily_limit_reached',
    })
    expect((await (await relationshipExplain(req({}), ctx)).json()).source).toBe('ai')
    expect((await (await dramaTellStory(req({ eventId: 'd1' }), ctx)).json()).source).toBe('ai')
  })
})
