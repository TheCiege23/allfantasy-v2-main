// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  spend: true,
  cached: null as null | { resultText: string },
  route: vi.fn(),
  save: vi.fn(async () => undefined),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/ai/aiSpendGuard', () => ({ isAiSpendEnabled: () => m.spend }))
vi.mock('@/lib/ai/ai-result-cache', () => ({
  getCachedAiResult: vi.fn(async () => m.cached),
  saveAiResult: m.save,
}))
vi.mock('@/lib/ai/providerRouter', () => ({ routeTextCall: m.route }))
vi.mock('@/lib/core-app/weeklyRoutine', () => ({ getRoutineFacts: vi.fn() }))

import { getWeeklyStoryHeadline } from '@/lib/core-app/weeklyStory'
import { buildWeeklyStory } from '@/lib/core-app/weeklyStoryModel'

const story = buildWeeklyStory({
  lastWeek: {
    rows: [
      { leagueId: 'a', leagueName: 'Alpha', platform: 'sleeper', season: 2026, week: 4, pointsFor: 120, pointsAgainst: 100, won: true, completed: true },
      { leagueId: 'b', leagueName: 'Beta', platform: 'espn', season: 2026, week: 4, pointsFor: 99, pointsAgainst: 100, won: false, completed: true },
    ],
    season: 2026,
    week: 4,
    withoutHistory: 0,
    unscored: 0,
    record: null,
  },
  topScorer: null,
  awards: [],
  upsets: [],
})!

const ok = (text: string) => ({ ok: true, text, model: 'm', provider: 'anthropic', tokensUsed: 20 })

beforeEach(() => {
  m.spend = true
  m.cached = null
  m.route.mockReset()
  m.save.mockClear()
})

describe('getWeeklyStoryHeadline', () => {
  it('is the template, with no model call, when AI spend is off', async () => {
    m.spend = false
    expect(await getWeeklyStoryHeadline('u1', story)).toEqual({ text: story.templateHeadline, source: 'template' })
    expect(m.route).not.toHaveBeenCalled()
  })

  it('serves a cached line without calling the model', async () => {
    m.cached = { resultText: JSON.stringify({ text: 'A split week.', source: 'chimmy' }) }
    expect(await getWeeklyStoryHeadline('u1', story)).toEqual({ text: 'A split week.', source: 'chimmy' })
    expect(m.route).not.toHaveBeenCalled()
  })

  it('returns and caches Chimmy’s line when every number in it is a fact', async () => {
    m.route.mockResolvedValue(ok('A 1-1 week, and Beta slipped away by just 1.'))
    expect(await getWeeklyStoryHeadline('u1', story)).toEqual({ text: 'A 1-1 week, and Beta slipped away by just 1.', source: 'chimmy' })
    expect(m.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'ok', scopeId: `u1:${story.id}`, feature: 'career_weekly_story_headline' }))
  })

  it('refuses an invented number, shows the template, and caches the refusal so it is not paid for twice', async () => {
    m.route.mockResolvedValue(ok('You went 3-0 and crushed it!'))
    expect(await getWeeklyStoryHeadline('u1', story)).toEqual({ text: story.templateHeadline, source: 'template' })
    expect(m.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'refused' }))
  })

  it('does not cache a provider outage — the next open may succeed', async () => {
    m.route.mockResolvedValue({ ok: false })
    expect(await getWeeklyStoryHeadline('u1', story)).toEqual({ text: story.templateHeadline, source: 'template' })
    m.route.mockRejectedValue(new Error('timeout'))
    expect(await getWeeklyStoryHeadline('u1', story)).toEqual({ text: story.templateHeadline, source: 'template' })
    expect(m.save).not.toHaveBeenCalled()
  })

  it('asks for a short, cheap call, metered to the feature and the user', async () => {
    m.route.mockResolvedValue(ok('A split week.'))
    await getWeeklyStoryHeadline('u1', story)
    expect(m.route).toHaveBeenCalledWith(expect.objectContaining({ profile: 'cheap', maxTokens: 80, feature: 'career_weekly_story_headline', userId: 'u1' }))
  })
})
