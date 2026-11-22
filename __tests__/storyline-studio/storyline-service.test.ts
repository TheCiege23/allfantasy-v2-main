import { beforeEach, describe, expect, it, vi } from 'vitest'

const broadcastRefusalMock = vi.fn()
const createLeagueChatMessageMock = vi.fn()
const createPredictionPollMock = vi.fn()
const afterPostMock = vi.fn()
const prismaMock = {
  leagueChatMessage: { findUnique: vi.fn() },
  league: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  $transaction: vi.fn(),
}

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/commissioner/broadcastAccess', () => ({ broadcastRefusal: broadcastRefusalMock }))
vi.mock('@/lib/league-chat/LeagueChatMessageService', () => ({ createLeagueChatMessage: createLeagueChatMessageMock }))
vi.mock('@/lib/league-chat/predictionPolls', () => ({
  createPredictionPoll: createPredictionPollMock,
  defaultAfterPost: () => afterPostMock,
}))
vi.mock('@/lib/subscription/FeatureGateService', () => ({
  FeatureGateService: class {
    evaluateUserFeatureAccess = vi.fn(async () => ({ allowed: false }))
  },
}))

import { isAutoPostDue, parseSettingsPatch, readStorylineSettings, withStorylineSettings } from '@/lib/storyline-studio/storylineSettings'
import { standingsFromFixtures } from '@/lib/storyline-studio/loadStoryData'
import type { StoryData } from '@/lib/storyline-studio/types'

/** Wednesday 2026-10-28 18:00 UTC = 14:00 in New York (EDT). */
const WED_2PM_NY = new Date('2026-10-28T18:00:00Z')

function storyData(): StoryData {
  const fixtures = [
    { season: 2025, week: 3, a: '1', b: '2', scoreA: 120, scoreB: 100, final: true },
    { season: 2026, week: 2, a: '2', b: '1', scoreA: 99, scoreB: 101, final: true },
  ]
  return {
    leagueId: 'l1',
    sport: 'NFL',
    season: 2026,
    week: 8,
    teams: new Map([
      ['1', { key: '1', name: 'Hawks' }],
      ['2', { key: '2', name: 'Owls' }],
    ]),
    matchups: [{ a: '1', b: '2', matchupId: 'mu1' }],
    fixtures,
    playoffs: [],
    playerWeeks: [],
    draftPicks: [],
    standings: standingsFromFixtures(fixtures, 2026),
    playerNames: new Map(),
    sources: { fixtures: 'redraft_matchups', playoffs: 'x', playerWeeks: 'x', draftPicks: 'x', standings: 'x' },
  }
}

function settingsWith(over: Record<string, unknown>) {
  return { storyline_studio: { autoPost: true, weekday: 3, hour: 12, timeZone: 'America/New_York', enabledByUserId: 'u1', ...over } }
}

describe('auto-post schedule', () => {
  it('is due from the chosen hour to the end of that local day, and not otherwise', () => {
    const s = readStorylineSettings(settingsWith({}))
    expect(isAutoPostDue(s, WED_2PM_NY)).toBe(true)
    expect(isAutoPostDue({ ...s, hour: 15 }, WED_2PM_NY)).toBe(false)
    expect(isAutoPostDue({ ...s, weekday: 4 }, WED_2PM_NY)).toBe(false)
    expect(isAutoPostDue({ ...s, timeZone: 'Asia/Tokyo' }, WED_2PM_NY)).toBe(false) // already Thursday there
    expect(isAutoPostDue({ ...s, autoPost: false }, WED_2PM_NY)).toBe(false)
  })

  it('is OFF by default and validates what a commissioner sends', () => {
    expect(readStorylineSettings({}).autoPost).toBe(false)
    expect(parseSettingsPatch({ hour: 25 })).toEqual({ ok: false, error: 'invalid_hour' })
    expect(parseSettingsPatch({ timeZone: 'Mars/Base' })).toEqual({ ok: false, error: 'invalid_timeZone' })
    expect(parseSettingsPatch({ autoPost: true, weekday: 2 })).toEqual({ ok: true, patch: { autoPost: true, weekday: 2 } })
  })

  it('writing back keeps every other league setting', () => {
    const next = withStorylineSettings({ other: 1 }, readStorylineSettings({}))
    expect(next.other).toBe(1)
    expect(next.storyline_studio).toBeTruthy()
  })
})

describe('the weekly sweep', () => {
  beforeEach(() => vi.clearAllMocks())

  async function sweep(over: Parameters<typeof import('@/lib/storyline-studio/storylineService').runStorylineAutoPost>[0]) {
    const { runStorylineAutoPost } = await import('@/lib/storyline-studio/storylineService')
    return runStorylineAutoPost({ now: WED_2PM_NY, load: async () => ({ league: {} as never, data: storyData() }), ...over })
  }

  it('posts the top hook with a per-league, per-week id, and its poll when asked', async () => {
    const post = vi.fn(async () => ({ ok: true as const, messageId: 'm', created: true, pollMessageId: 'p' }))
    const run = await sweep({
      listLeagues: async () => [{ id: 'l1', platform: 'manual', settings: settingsWith({ includePoll: true }) }],
      entitled: async () => true,
      post,
    })
    expect(run.posted).toBe(1)
    const arg = (post.mock.calls[0] as unknown[])[0] as Record<string, unknown>
    expect(arg).toMatchObject({ leagueId: 'l1', userId: 'u1', includePoll: true, matchupId: 'mu1', auto: true, messageId: 'storyline_l1_2026-w08' })
    expect(String(arg.text)).toContain('Hawks')
  })

  it('is idempotent per week: a recorded week, or a duplicate row id, does not post again', async () => {
    const post = vi.fn(async () => ({ ok: true as const, messageId: 'm', created: false, pollMessageId: null }))
    const recorded = await sweep({
      listLeagues: async () => [
        { id: 'l1', platform: 'manual', settings: settingsWith({ posted: { '2026-w08': { at: 'x', messageId: 'm', hookId: 'h', auto: true } } }) },
      ],
      entitled: async () => true,
      post,
    })
    expect(recorded.alreadyPosted).toBe(1)
    expect(post).not.toHaveBeenCalled()

    const raced = await sweep({ listLeagues: async () => [{ id: 'l1', platform: 'manual', settings: settingsWith({}) }], entitled: async () => true, post })
    expect(raced).toMatchObject({ posted: 0, alreadyPosted: 1 })
  })

  it('a lapsed plan stops auto-posting (the switch stays on)', async () => {
    const post = vi.fn()
    const run = await sweep({ listLeagues: async () => [{ id: 'l1', platform: 'manual', settings: settingsWith({}) }], entitled: async () => false, post })
    expect(run.notEntitled).toBe(1)
    expect(post).not.toHaveBeenCalled()
  })

  it('never auto-posts into an imported league, whatever its settings say', async () => {
    const post = vi.fn()
    const run = await sweep({ listLeagues: async () => [{ id: 'l1', platform: 'sleeper', settings: settingsWith({}) }], entitled: async () => true, post })
    expect(run.refused).toBe(1)
    expect(post).not.toHaveBeenCalled()
  })

  it('waits for the commissioner’s day and hour', async () => {
    const post = vi.fn()
    const run = await sweep({ listLeagues: async () => [{ id: 'l1', platform: 'manual', settings: settingsWith({ weekday: 5 }) }], entitled: async () => true, post })
    expect(run.notDue).toBe(1)
    expect(post).not.toHaveBeenCalled()
  })
})

describe('posting a storyline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.leagueChatMessage.findUnique.mockResolvedValue(null)
    createLeagueChatMessageMock.mockResolvedValue({ id: 'msg1', senderName: 'Comm', senderAvatarUrl: null })
    prismaMock.$transaction.mockResolvedValue(null)
  })

  it('is refused server-side for an imported league', async () => {
    const { postStoryline } = await import('@/lib/storyline-studio/storylineService')
    broadcastRefusalMock.mockResolvedValue('imported')
    expect(await postStoryline({ leagueId: 'l1', userId: 'u1', text: 'Hi', hook: null })).toEqual({ ok: false, error: 'imported' })
    expect(createLeagueChatMessageMock).not.toHaveBeenCalled()
  })

  it('a native league posts an ordinary chat message (subtype storyline) with the opt-in side effects only', async () => {
    const { postStoryline } = await import('@/lib/storyline-studio/storylineService')
    broadcastRefusalMock.mockResolvedValue(null)
    createPredictionPollMock.mockResolvedValue({ ok: true, messageId: 'predpoll_mu1', created: true })
    const res = await postStoryline({ leagueId: 'l1', userId: 'u1', text: 'Hawks lead 2-1.', hook: null, matchupId: 'mu1', includePoll: true })
    expect(res).toEqual({ ok: true, messageId: 'msg1', created: true, pollMessageId: 'predpoll_mu1' })
    const [, author, body, opts] = createLeagueChatMessageMock.mock.calls[0]
    expect([author, body]).toEqual(['u1', 'Hawks lead 2-1.'])
    expect(opts).toMatchObject({ type: 'text', messageSubtype: 'storyline' })
    expect(afterPostMock).toHaveBeenCalledOnce()
  })

  it('an auto-post whose row already exists is not posted twice', async () => {
    const { postStoryline } = await import('@/lib/storyline-studio/storylineService')
    broadcastRefusalMock.mockResolvedValue(null)
    prismaMock.leagueChatMessage.findUnique.mockResolvedValue({ id: 'storyline_l1_2026-w08' })
    const res = await postStoryline({ leagueId: 'l1', userId: 'u1', text: 'x', hook: null, messageId: 'storyline_l1_2026-w08', auto: true })
    expect(res).toMatchObject({ ok: true, created: false })
    expect(createLeagueChatMessageMock).not.toHaveBeenCalled()
  })

  it('refuses a co-commissioner without chat permission, and empty or overlong text', async () => {
    const { postStoryline } = await import('@/lib/storyline-studio/storylineService')
    broadcastRefusalMock.mockResolvedValue('forbidden')
    expect(await postStoryline({ leagueId: 'l1', userId: 'u2', text: 'x', hook: null })).toEqual({ ok: false, error: 'forbidden' })
    expect(await postStoryline({ leagueId: 'l1', userId: 'u1', text: '  ', hook: null })).toEqual({ ok: false, error: 'empty' })
    expect(await postStoryline({ leagueId: 'l1', userId: 'u1', text: 'x'.repeat(1001), hook: null })).toEqual({ ok: false, error: 'too_long' })
  })
})
