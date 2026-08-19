import { describe, it, expect, vi } from 'vitest'
import { StoryEngine, buildStoryContext, generateStoryDraft, buildStoryPrompt, ALL_STORY_TYPES, STORY_TYPES, type StoryDataSource } from '@/lib/story'
import { IntelligenceAccessError } from '@/lib/intelligence/IntelligenceQueryService'

// A league-internal user id that MUST NOT leak into any story output.
const SECRET_USER_ID = 'usr_secret_1234567890'

function okSource(overrides: Partial<Record<keyof StoryDataSource, any>> = {}): StoryDataSource {
  return {
    getLeagueActivitySummary: vi.fn(async () => ({
      leagueId: 'L1', sport: 'nfl', leagueConcept: 'redraft', totalEvents: 12,
      firstEventAt: '2026-06-01T00:00:00.000Z', lastActivityAt: '2026-06-26T00:00:00.000Z',
      openTradeProposals: 2,
      counts: { trade: 4, waiver: 3, lineup: 2, draft: 1, scoring: 2, governance: 0, lifecycle: 0, other: 0 },
    })),
    getLeagueHealthSnapshot: vi.fn(async () => ({
      leagueId: 'L1', lastActivityAt: '2026-06-26T00:00:00.000Z', daysSinceLastActivity: 2,
      totalManagers: 10, activeManagers: 7, openTradeProposals: 2, healthScore: 72, status: 'healthy' as const,
    })),
    // meta carries a private user id — the builder must strip it.
    getCommissionerActionItems: vi.fn(async () => ([
      { kind: 'pending_trades', severity: 'warning', message: '2 trade proposal(s) awaiting resolution.', meta: { openTradeProposals: 2 } },
      { kind: 'inactive_managers', severity: 'action', message: '1 manager(s) inactive for over 14 days.', meta: { managerKeys: [SECRET_USER_ID] } },
    ])),
    getLeagueAuditFeed: vi.fn(async () => ({
      items: [
        { eventId: 'e1', type: 'transaction.trade.accepted', summary: 'A trade was accepted', occurredAt: '2026-06-26T00:00:00.000Z', actorType: 'manager', sport: 'nfl', leagueConcept: 'redraft' },
        { eventId: 'e2', type: 'transaction.waiver.processed', summary: 'Waivers processed', occurredAt: '2026-06-25T00:00:00.000Z', actorType: 'system', sport: 'nfl', leagueConcept: 'redraft' },
      ],
      nextCursor: null,
    })),
    ...overrides,
  } as unknown as StoryDataSource
}

function emptySource(): StoryDataSource {
  return okSource({
    getLeagueActivitySummary: vi.fn(async () => ({
      leagueId: 'L1', sport: 'nfl', leagueConcept: 'redraft', totalEvents: 0,
      firstEventAt: null, lastActivityAt: null, openTradeProposals: 0,
      counts: { trade: 0, waiver: 0, lineup: 0, draft: 0, scoring: 0, governance: 0, lifecycle: 0, other: 0 },
    })),
  })
}

describe('G15.12 Story Context Builder', () => {
  it('constructs an ok privacy-safe context from the read models', async () => {
    const ctx = await buildStoryContext({ source: okSource(), leagueId: 'L1' })
    expect(ctx.status).toBe('ok')
    expect(ctx.activity.totalEvents).toBe(12)
    expect(ctx.health.score).toBe(72)
    expect(ctx.recent).toHaveLength(2)
    expect(ctx.actionItems).toHaveLength(2)
    // action-item meta is stripped — only safe label fields survive
    expect(Object.keys(ctx.actionItems[0])).toEqual(['kind', 'severity', 'message'])
  })

  it('empty-state: no recorded activity → status empty', async () => {
    const ctx = await buildStoryContext({ source: emptySource(), leagueId: 'L1' })
    expect(ctx.status).toBe('empty')
    expect(ctx.activity.totalEvents).toBe(0)
  })

  it('restricted: feature-gate/access error → status restricted, never throws', async () => {
    const src = okSource({
      getLeagueActivitySummary: vi.fn(async () => { throw new IntelligenceAccessError('activity_summary' as any, 'deny') }),
    })
    const ctx = await buildStoryContext({ source: src, leagueId: 'L1' })
    expect(ctx.status).toBe('restricted')
  })

  it('never throws on an unexpected error → degrades to empty', async () => {
    const src = okSource({ getLeagueHealthSnapshot: vi.fn(async () => { throw new Error('db down') }) })
    const ctx = await buildStoryContext({ source: src, leagueId: 'L1' })
    expect(ctx.status).toBe('empty')
  })

  it('privacy: no private user id appears anywhere in the context', async () => {
    const ctx = await buildStoryContext({ source: okSource(), leagueId: 'L1' })
    expect(JSON.stringify(ctx)).not.toContain(SECRET_USER_ID)
  })
})

describe('G15.12 Story Generator — each initial story type', () => {
  it('produces a non-empty draft for every story type', async () => {
    const ctx = await buildStoryContext({ source: okSource(), leagueId: 'L1' })
    for (const type of ALL_STORY_TYPES) {
      const draft = generateStoryDraft(type, ctx)
      expect(draft.empty).toBe(false)
      expect(draft.type).toBe(type)
      expect(draft.title.length).toBeGreaterThan(0)
      expect(draft.headline.length).toBeGreaterThan(0)
      expect(draft.sections.length).toBeGreaterThan(0)
      expect(draft.text.length).toBeGreaterThan(0)
      // privacy: no user id leakage in rendered output
      expect(JSON.stringify(draft)).not.toContain(SECRET_USER_ID)
    }
  })

  it('weekly recap reflects activity + engagement', async () => {
    const ctx = await buildStoryContext({ source: okSource(), leagueId: 'L1' })
    const d = generateStoryDraft(STORY_TYPES.WEEKLY_RECAP, ctx)
    expect(d.text).toContain('12 recorded action')
    expect(d.text).toMatch(/7 of 10 manager/)
  })

  it('commissioner summary surfaces action items cautiously', async () => {
    const ctx = await buildStoryContext({ source: okSource(), leagueId: 'L1' })
    const d = generateStoryDraft(STORY_TYPES.COMMISSIONER_SUMMARY, ctx)
    expect(d.text).toContain('72/100')
    expect(d.text).toContain('awaiting resolution')
    expect(d.text).toMatch(/not accusations/i)
  })

  it('what-happened-recently renders the timeline', async () => {
    const ctx = await buildStoryContext({ source: okSource(), leagueId: 'L1' })
    const d = generateStoryDraft(STORY_TYPES.WHAT_HAPPENED_RECENTLY, ctx)
    expect(d.text).toContain('A trade was accepted')
  })

  it('empty-state draft for every type when there is no activity', async () => {
    const ctx = await buildStoryContext({ source: emptySource(), leagueId: 'L1' })
    for (const type of ALL_STORY_TYPES) {
      const d = generateStoryDraft(type, ctx)
      expect(d.empty).toBe(true)
      expect(d.text).toMatch(/not enough recorded league activity/i)
    }
  })

  it('restricted context yields a safe non-leaking notice', async () => {
    const src = okSource({ getLeagueActivitySummary: vi.fn(async () => { throw new IntelligenceAccessError('activity_summary' as any, 'deny') }) })
    const ctx = await buildStoryContext({ source: src, leagueId: 'L1' })
    const d = generateStoryDraft(STORY_TYPES.WEEKLY_RECAP, ctx)
    expect(d.empty).toBe(true)
    expect(d.status).toBe('restricted')
    expect(d.text).toMatch(/not available/i)
  })
})

describe('G15.12 LLM-ready prompt output', () => {
  it('builds a privacy-safe prompt pair without calling any model', async () => {
    const ctx = await buildStoryContext({ source: okSource(), leagueId: 'L1' })
    const p = buildStoryPrompt(STORY_TYPES.WEEKLY_RECAP, ctx)
    expect(p.system).toMatch(/storyteller/i)
    expect(p.system).toMatch(/not accusations|no claims/i)
    expect(p.user).toContain('Story type: weekly_recap')
    // privacy: prompt body must not carry user ids or raw payload keys
    expect(p.user).not.toContain(SECRET_USER_ID)
    expect(p.user).not.toContain('payload')
  })
})

describe('G15.12 StoryEngine facade', () => {
  it('generateStory + generateAllStories + buildPrompt from one source', async () => {
    const engine = new StoryEngine(okSource())
    const one = await engine.generateStory({ leagueId: 'L1', type: STORY_TYPES.HEALTH_NARRATIVE })
    expect(one.type).toBe(STORY_TYPES.HEALTH_NARRATIVE)
    expect(one.text).toContain('72/100')

    const all = await engine.generateAllStories({ leagueId: 'L1' })
    expect(all).toHaveLength(ALL_STORY_TYPES.length)
    expect(all.every((d) => !d.empty)).toBe(true)

    const prompt = await engine.buildPrompt({ leagueId: 'L1', type: STORY_TYPES.ACTIVITY_REPORT })
    expect(prompt.type).toBe(STORY_TYPES.ACTIVITY_REPORT)
  })
})
