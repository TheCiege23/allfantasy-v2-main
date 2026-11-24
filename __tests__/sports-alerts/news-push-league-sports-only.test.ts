import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * 🛑 News pushes only for a sport you have a league in, or a story about a team you follow (owner,
 * 2026-11-22). A sport ticked on your profile with no league in it — measured: 8 Soccer pushes a day
 * on the owner's account — now reaches the bell only.
 */
const h = vi.hoisted(() => ({
  news: vi.fn(),
  claim: vi.fn(),
  remove: vi.fn(),
  dispatch: vi.fn(),
  playing: vi.fn(),
  audience: vi.fn(),
  followers: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: { sportsNews: { findMany: h.news }, sportsDataCache: { create: h.claim, delete: h.remove } } }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: h.dispatch }))
vi.mock('@/lib/notifications/sportAudience', () => ({ listUserIdsPlayingSport: h.playing, listSportsAlertAudience: h.audience }))
vi.mock('@/lib/follows/teamFollows', () => ({
  isTeamFollowSport: () => true,
  listFollowerIdsForTeam: h.followers,
  listTeamsForSport: async () => [{ abbr: 'HOU', name: 'Houston Texans' }],
  getTeamIndex: async () => null,
}))
vi.mock('@/lib/follows/teamResolver', () => ({ resolveTeam: () => null }))

import { dispatchBreakingNewsAlerts, isHighlightsClip, splitNewsAudience } from '@/lib/news/breakingNewsAlerts'

const NOW = new Date('2026-11-01T17:05:00Z')
const story = (title: string) => ({
  id: 'n1', sport: 'NFL', title, description: null, source: 'ESPN',
  sourceUrl: 'https://www.espn.com/nfl/story/_/id/1', team: null,
  publishedAt: new Date('2026-11-01T17:00:00Z'), fetchedAt: new Date('2026-11-01T17:00:00Z'),
})

beforeEach(() => {
  vi.resetAllMocks()
  h.claim.mockResolvedValue({})
  h.dispatch.mockResolvedValue({ requested: 1, delivered: 1, suppressed: 0, failed: 0 })
  h.playing.mockResolvedValue(['in-league'])
  // The sport audience as it was: league members, profile ticks, and follows of ANY team in the sport.
  h.audience.mockResolvedValue(['in-league', 'profile-only', 'follows-other-team'])
  h.followers.mockResolvedValue([])
})

describe('splitNewsAudience', () => {
  it('pushes to league members and followers of a named team; everyone else is bell only', () => {
    expect(
      splitNewsAudience({ playing: ['a', 'b'], namedTeamFollowers: ['fan'], sportAudience: ['a', 'b', 'fan', 'tick'] }),
    ).toEqual({ push: ['fan', 'a', 'b'], feedOnly: ['tick'] })
  })
  it('never lists one person in both', () => {
    const r = splitNewsAudience({ playing: ['a'], namedTeamFollowers: ['a'], sportAudience: ['a'] })
    expect(r).toEqual({ push: ['a'], feedOnly: [] })
  })
})

describe('news dispatch', () => {
  it('a sport you only ticked on your profile: the story reaches your bell, never your phone', async () => {
    h.news.mockResolvedValue([story('Giants begin training camp')])
    const r = await dispatchBreakingNewsAlerts({ now: NOW })
    expect(r.sent).toBe(1)
    const calls = h.dispatch.mock.calls.map(([arg]) => arg)
    const pushCall = calls.find((c) => !c.skipChannels.push)
    const bellCall = calls.find((c) => c.skipChannels.push === true)
    expect(pushCall?.userIds).toEqual(['in-league'])
    expect(bellCall?.userIds).toEqual(['profile-only', 'follows-other-team'])
    expect(bellCall?.skipChannels).toEqual({ email: true, sms: true, push: true })
    expect(r.recipients).toBe(3)
  })

  it('a story about a team you follow still pushes, with no league in the sport', async () => {
    h.news.mockResolvedValue([story('Texans sign veteran long snapper')])
    h.followers.mockImplementation(async (_s: string, team: string) => (team === 'HOU' ? ['follows-other-team'] : []))
    await dispatchBreakingNewsAlerts({ now: NOW })
    const pushCall = h.dispatch.mock.calls.map(([a]) => a).find((c) => !c.skipChannels.push)
    expect(pushCall?.userIds).toEqual(['follows-other-team', 'in-league'])
  })

  it('[control] when everyone plays the sport, there is one push send and no bell-only send', async () => {
    h.news.mockResolvedValue([story('Giants begin training camp')])
    h.audience.mockResolvedValue(['in-league'])
    await dispatchBreakingNewsAlerts({ now: NOW })
    expect(h.dispatch).toHaveBeenCalledTimes(1)
    expect(h.dispatch.mock.calls[0][0].skipChannels).toEqual({ email: true, sms: true })
  })

  it('a failed bell-only send releases the story for a retry, like a failed push send', async () => {
    h.news.mockResolvedValue([story('Giants begin training camp')])
    h.dispatch.mockImplementation(async (arg: { skipChannels: { push?: boolean } }) =>
      arg.skipChannels.push ? { requested: 2, delivered: 1, suppressed: 0, failed: 1 } : { requested: 1, delivered: 1, suppressed: 0, failed: 0 },
    )
    await expect(dispatchBreakingNewsAlerts({ now: NOW })).rejects.toThrow(/incomplete/)
    expect(h.remove).toHaveBeenCalled()
  })
})

/*
 * 🛑 Highlights clips reach the bell only, never a phone (owner, 2026-11-23): ESPN posts one per game, and
 * 754 of the week's 4,160 news pushes were highlights.
 */
describe('highlights clips', () => {
  it('recognises a game highlights clip by its title, and leaves real stories that use the word', () => {
    expect(isHighlightsClip('Yale Bulldogs vs. Belmont Bruins: Game Highlights')).toBe(true)
    expect(isHighlightsClip('Vancouver Whitecaps vs. Real Salt Lake - Game Highlights')).toBe(true)
    expect(isHighlightsClip('Yale Bulldogs vs. Harvard Crimson: Full Highlights ')).toBe(true)
    expect(isHighlightsClip("Josh Heupel highlights creativity behind Tennessee's offense")).toBe(false)
    expect(isHighlightsClip('ESPN Highlights Recurring Problem for Bills, Head Coach Joe Brady')).toBe(false)
    expect(isHighlightsClip("Justin Herbert's highlight-reel touchdown can't save 1-9 Chargers")).toBe(false)
  })

  it('a highlights clip goes to everyone in the bell, including people it would have pushed to', async () => {
    h.news.mockResolvedValue([story('Rochester Tigers vs. Buffalo Bulls: Game Highlights')])
    await dispatchBreakingNewsAlerts({ now: NOW })
    const calls = h.dispatch.mock.calls.map(([arg]) => arg)
    expect(calls.find((c) => !c.skipChannels.push)).toBeUndefined()
    const bell = calls.find((c) => c.skipChannels.push === true)
    expect(bell?.userIds).toEqual(['in-league', 'profile-only', 'follows-other-team'])
    expect(h.dispatch).toHaveBeenCalledTimes(1)
  })

  it('[control] a real story in the same sport still pushes to league members', async () => {
    h.news.mockResolvedValue([story('Rochester coach fired after season opener')])
    await dispatchBreakingNewsAlerts({ now: NOW })
    const pushCall = h.dispatch.mock.calls.map(([a]) => a).find((c) => !c.skipChannels.push)
    expect(pushCall?.userIds).toEqual(['in-league'])
  })
})
