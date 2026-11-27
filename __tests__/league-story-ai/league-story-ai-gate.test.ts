// @vitest-environment node
/**
 * 🛑 OWNER'S DECISION (2026-11-27): Chimmy's Hall of Fame, league story and rivalry write-ups are unlocked for
 * a whole league by its COMMISSIONER holding AF Commissioner or AF Supreme, and each has a per-league daily
 * cap. The gating audit found these routes with no plan check and no cap — every click a paid model call.
 *
 * Every gated entry point is driven here through its real route, with the model mocked, and the plan decided
 * by the REAL plan maths (`hasFeatureAccessForPlans`, so AF Supreme including AF Commissioner is exercised,
 * not assumed). The daily counter is an in-memory stand-in for `consumeDailyLimit` that honours `callsLimit`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  session: { user: { id: 'member-u' } } as { user: { id: string } } | null,
  commissioner: 'comm-c' as string | null,
  counters: new Map<string, number>(),
  counterCalls: [] as Array<{ provider: string; endpoint: string; callsLimit?: number }>,
  orchestrate: vi.fn(),
  openaiChatText: vi.fn(),
  createLeagueStory: vi.fn(),
  rewriteHookInTone: vi.fn(),
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
  prisma: {
    league: {
      findUnique: async () => ({ userId: h.commissioner, name: 'Test League', sport: 'NFL', leagueSize: 12, season: 2026 }),
    },
    teamWeekResult: {
      findFirst: async () => ({ week: 3 }),
      findMany: async () => [{ rosterId: 'r1', totalPoints: 120, opponentRosterId: 'r2', winLoss: 'W' }],
    },
    leagueStoryline: { create: async () => ({ id: 's1', title: 'Week 3 Storyline', body: 'Grounded.' }) },
  },
}))

vi.mock('@/lib/api/require-league-access', () => ({
  requireLeagueApiAccess: async () => ({ ok: true, leagueId: 'L1', userId: h.session?.user.id ?? 'x', access: {} }),
}))
vi.mock('@/lib/league-access', () => ({
  resolveLeagueAccess: async () => ({ isMember: true }),
  assertLeagueMember: async () => ({ leagueSport: 'NFL' }),
}))

// ── Model call sites (what "the model was never called" is asserted on) ───────────────────────────────
vi.mock('@/lib/ai-orchestration', () => ({ runUnifiedOrchestration: h.orchestrate }))
vi.mock('@/lib/openai-client', () => ({ openaiChatText: h.openaiChatText }))
vi.mock('@/lib/league-story-creator', () => ({
  createLeagueStory: h.createLeagueStory,
  getStoryVariant: () => 'v',
  storyToMediaShape: () => null,
}))
vi.mock('@/lib/league-story-creator/OneBrainNarrativeComposer', () => ({ rewriteHookInTone: h.rewriteHookInTone }))

vi.mock('@/lib/ai-tool-layer', () => ({
  buildEnvelopeForTool: () => ({}),
  formatToolResult: () => ({ output: { narrative: 'AI WRITE-UP', verdict: 'v' }, factGuardWarnings: [], sections: [] }),
  validateToolOutput: () => ({ warnings: [], errors: [] }),
}))

// ── Hall of Fame facts ───────────────────────────────────────────────────────────────────────────────
vi.mock('@/lib/hall-of-fame-engine/HallOfFameQueryService', () => ({
  getEntryByIdScoped: async () => ({
    id: 'e1', title: 'The 2024 Dynasty', summary: 'Three titles.', sport: 'NFL', leagueId: 'L1', season: '2024',
    category: 'dynasties', score: 0.91, entityType: 'MANAGER', entityId: 'm1', inductedAt: new Date('2025-01-01'), metadata: {},
  }),
  getMomentByIdScoped: async () => null,
}))

// ── Rivalry facts ────────────────────────────────────────────────────────────────────────────────────
vi.mock('@/lib/rivalry-engine/RivalryQueryService', () => ({
  getRivalryById: async () => ({
    id: 'rv1', leagueId: 'L1', sport: 'NFL', managerAId: 'mA', managerBId: 'mB', rivalryScore: 77.5, rivalryTier: 'heated', eventCount: 4,
  }),
}))
vi.mock('@/lib/rivalry-engine/RivalryTimelineBuilder', () => ({ buildTimelineForRivalry: async () => [] }))
vi.mock('@/lib/rivalry-engine/RivalryTierResolver', () => ({ getRivalryTierLabel: () => 'Heated' }))
vi.mock('@/lib/rivalry-engine/SportRivalryResolver', () => ({ getRivalrySportLabel: () => 'Football' }))
vi.mock('@/lib/drama-engine/DramaQueryService', () => ({ listDramaEvents: async () => [] }))

// ── league-story ─────────────────────────────────────────────────────────────────────────────────────
vi.mock('@/lib/notification-engine', () => ({ ingest: () => undefined, storylineGenerated: (x: unknown) => x }))
vi.mock('@/lib/injuries', () => ({ getInjuries: async () => [] }))
vi.mock('@/lib/scoring-engine/resolveTeamLabels', () => ({ buildRosterLabelMap: async () => new Map([['r1', 'Hawks'], ['r2', 'Owls']]) }))

// ── Storyline Studio ─────────────────────────────────────────────────────────────────────────────────
const HOOK = { id: 'h1', text: 'Hawks lead Owls 2-1.', facts: [{ key: 'leaderWins', value: 2, source: 'f' }] }
vi.mock('@/lib/league/permissions', () => ({ getLeagueRole: async () => 'commissioner' }))
vi.mock('@/lib/league/commissionerAccess', () => ({ canCommissionerAct: async () => true }))
vi.mock('@/lib/storyline-studio/storylineService', () => ({
  storylineEntitled: async () => true,
  readStudioView: async () => ({ hooks: { byMatchup: [{ hooks: [HOOK] }], league: [] } }),
}))
vi.mock('@/lib/league-story-creator/StoryFactGuard', () => ({ validateHookRewrite: () => ({ passed: true, errors: [] }) }))
vi.mock('@/lib/chat-core/censorProfanity', () => ({ hasProfanity: () => false }))

import { POST as hofTellStory } from '@/app/api/leagues/[leagueId]/hall-of-fame/tell-story/route'
import { POST as rivalryExplain } from '@/app/api/leagues/[leagueId]/rivalries/explain/route'
import { POST as leagueStory } from '@/app/api/league-story/route'
import { POST as storyCreate } from '@/app/api/leagues/[leagueId]/story/create/route'
import { POST as storylineRewrite } from '@/app/api/leagues/[leagueId]/storylines/rewrite/route'

const ctx = { params: Promise.resolve({ leagueId: 'L1' }) }
const req = (body: unknown) =>
  new Request('http://localhost/x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

type Entry = {
  name: string
  kind: 'hall_of_fame' | 'league_story' | 'rivalry'
  limit: number
  /** true = a fact-built version is served when locked; false = the standard 403. */
  hasFallback: boolean
  call: (body?: Record<string, unknown>) => Promise<Response>
  model: () => ReturnType<typeof vi.fn>
}

const ENTRIES: Entry[] = [
  { name: 'POST /hall-of-fame/tell-story', kind: 'hall_of_fame', limit: 5, hasFallback: true,
    call: (b = {}) => hofTellStory(req({ type: 'entry', id: 'e1', ...b }), ctx), model: () => h.orchestrate },
  { name: 'POST /rivalries/explain', kind: 'rivalry', limit: 10, hasFallback: true,
    call: (b = {}) => rivalryExplain(req({ rivalryId: 'rv1', ...b }), ctx), model: () => h.orchestrate },
  { name: 'POST /api/league-story', kind: 'league_story', limit: 10, hasFallback: false,
    call: (b = {}) => leagueStory(req({ leagueId: 'L1', week: 3, ...b }) as never), model: () => h.openaiChatText },
  { name: 'POST /story/create', kind: 'league_story', limit: 10, hasFallback: false,
    call: (b = {}) => storyCreate(req({ storyType: 'rivalry', ...b }), ctx), model: () => h.createLeagueStory },
  { name: 'POST /storylines/rewrite', kind: 'league_story', limit: 10, hasFallback: true,
    call: (b = {}) => storylineRewrite(req({ hookId: 'h1', tone: 'announcer', ...b }), ctx), model: () => h.rewriteHookInTone },
]

beforeEach(() => {
  h.session = { user: { id: 'member-u' } }
  h.commissioner = 'comm-c'
  h.counters.clear()
  h.counterCalls.length = 0
  h.orchestrate.mockReset().mockResolvedValue({ ok: true, response: { primaryAnswer: 'AI WRITE-UP', modelOutputs: [] } })
  h.openaiChatText.mockReset().mockResolvedValue({ ok: true, text: 'AI WRITE-UP' })
  h.createLeagueStory.mockReset().mockResolvedValue({ ok: true, story: { headline: 'AI WRITE-UP', source: 'ai' }, sections: [] })
  h.rewriteHookInTone.mockReset().mockResolvedValue('Hawks over Owls, 2-1!')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe.each(ENTRIES)('$name', (entry) => {
  it.each(['free-c', 'pro-c'])('a %s commissioner\'s league: no model call, and the standard paywall', async (commish) => {
    h.commissioner = commish
    const res = await entry.call()
    const body = await res.json()
    expect(entry.model()).not.toHaveBeenCalled()
    if (entry.hasFallback) {
      expect(res.status).toBe(200)
      expect(body.aiLocked).toMatchObject({ code: 'feature_not_entitled', requiredPlan: 'AF Commissioner' })
    } else {
      expect(res.status).toBe(403)
      expect(body).toMatchObject({ code: 'feature_not_entitled', requiredPlan: 'AF Commissioner', featureId: 'storyline_creation' })
    }
    // A locked league never touches the counter.
    expect(h.counterCalls).toHaveLength(0)
  })

  it('a league with no commissioner on record is locked too (fails closed)', async () => {
    h.commissioner = null
    await entry.call()
    expect(entry.model()).not.toHaveBeenCalled()
  })

  it.each(['comm-c', 'sup-c'])('an %s commissioner\'s league gets the model write-up (200)', async (commish) => {
    h.commissioner = commish
    const res = await entry.call()
    expect(res.status).toBe(200)
    expect(entry.model()).toHaveBeenCalledTimes(1)
    expect(h.counterCalls[0]).toMatchObject({ provider: 'league_story_ai', endpoint: `${entry.kind}:L1`, callsLimit: entry.limit })
  })

  it('a member with no plan of their own, in an entitled league, gets it (200) — the commissioner\'s plan decides', async () => {
    h.session = { user: { id: 'member-u' } }
    h.commissioner = 'sup-c'
    const res = await entry.call()
    expect(res.status).toBe(200)
    expect(entry.model()).toHaveBeenCalledTimes(1)
  })

  it(`the daily cap is enforced at the limit for the league`, async () => {
    for (let i = 0; i < entry.limit; i++) {
      expect((await entry.call()).status).toBe(200)
    }
    const res = await entry.call()
    const body = await res.json()
    expect(entry.model()).toHaveBeenCalledTimes(entry.limit)
    if (entry.hasFallback) {
      expect(res.status).toBe(200)
      expect(body.aiLocked).toMatchObject({ code: 'daily_limit_reached', limit: entry.limit })
    } else {
      expect(res.status).toBe(429)
      expect(body).toMatchObject({ code: 'daily_limit_reached', limit: entry.limit })
      expect(res.headers.get('Retry-After')).toBe('3600')
    }
  })

  it('Spanish copy when asked', async () => {
    h.commissioner = 'free-c'
    const body = await (await entry.call({ lang: 'es' })).json()
    const message = String((entry.hasFallback ? body.aiLocked : body).message)
    expect(message).toContain('comisionado')
  })
})

describe('the fact-built version stays free when locked', () => {
  beforeEach(() => {
    h.commissioner = 'free-c'
  })

  it('Hall of Fame: the template narrative from the entry\'s facts', async () => {
    const body = await (await hofTellStory(req({ type: 'entry', id: 'e1' }), ctx)).json()
    expect(body.source).toBe('template')
    expect(body.narrative).toContain('The 2024 Dynasty')
    expect(body.narrative).toContain('Induction score: 0.91')
    expect(body.narrative).not.toContain('AI WRITE-UP')
  })

  it('Rivalry: the template narrative from the rivalry\'s facts', async () => {
    const body = await (await rivalryExplain(req({ rivalryId: 'rv1' }), ctx)).json()
    expect(body.source).toBe('template')
    expect(body.narrative).toContain('77.5/100')
    expect(body.narrative).not.toContain('AI WRITE-UP')
  })

  it('Storyline Studio: the hook\'s template text, with the reason', async () => {
    const body = await (await storylineRewrite(req({ hookId: 'h1', tone: 'announcer' }), ctx)).json()
    expect(body).toMatchObject({ source: 'template', text: HOOK.text })
    expect(body.message).toMatch(/AF Commissioner/)
  })

  it('[control] entitled: the same routes return the model write-up instead', async () => {
    h.commissioner = 'comm-c'
    expect((await (await hofTellStory(req({ type: 'entry', id: 'e1' }), ctx)).json()).narrative).toBe('AI WRITE-UP')
    expect((await (await rivalryExplain(req({ rivalryId: 'rv1' }), ctx)).json()).source).toBe('ai')
    expect((await (await storylineRewrite(req({ hookId: 'h1', tone: 'announcer' }), ctx)).json()).source).toBe('ai')
  })
})

describe('a bad request costs no cap', () => {
  it('an invalid storyType / tone is refused before the counter', async () => {
    expect((await storyCreate(req({ storyType: 'nope' }), ctx)).status).toBe(400)
    expect((await storylineRewrite(req({ hookId: 'h1', tone: 'roast' }), ctx)).status).toBe(400)
    expect(h.counterCalls).toHaveLength(0)
  })

  it('caps are per kind: ten league stories leave the Hall of Fame allowance untouched', async () => {
    for (let i = 0; i < 10; i++) await leagueStory(req({ leagueId: 'L1', week: 3 }) as never)
    expect((await leagueStory(req({ leagueId: 'L1', week: 3 }) as never)).status).toBe(429)
    const hof = await (await hofTellStory(req({ type: 'entry', id: 'e1' }), ctx)).json()
    expect(hof.source).toBe('ai')
  })
})
