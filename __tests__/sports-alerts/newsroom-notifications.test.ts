import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ news: vi.fn(), claim: vi.fn(), remove: vi.fn(), dispatch: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { sportsNews: { findMany: h.news }, sportsDataCache: { create: h.claim, delete: h.remove } } }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: h.dispatch }))
vi.mock('@/lib/notifications/sportAudience', () => ({ listSportsAlertAudience: async () => ['fan'] }))
vi.mock('@/lib/follows/teamFollows', () => ({ isTeamFollowSport: () => false, listFollowerIdsForTeam: async () => [], listTeamsForSport: async () => [], getTeamIndex: async () => null }))
vi.mock('@/lib/follows/teamResolver', () => ({ resolveTeam: () => null }))

import { dispatchBreakingNewsAlerts } from '@/lib/news/breakingNewsAlerts'
import { newsDeliveryKey } from '@/lib/news/newsroomFilter'

beforeEach(() => {
  vi.resetAllMocks()
  h.claim.mockResolvedValue({})
  h.dispatch.mockResolvedValue({ requested: 1, delivered: 1, suppressed: 0, failed: 0 })
})

describe('admin newsroom alerts', () => {
  it('lets a new day reuse a headline while deduplicating overlapping feeds on the same day', () => {
    const at = new Date('2026-11-01T17:00:00Z')
    expect(newsDeliveryKey('nfl', 'Giants begin training camp', at)).toBe(newsDeliveryKey('NFL', 'Giants begin training camp', at))
    expect(newsDeliveryKey('NFL', 'Giants begin training camp', at)).not.toBe(newsDeliveryKey('NFL', 'Giants begin training camp', new Date('2026-11-02T17:00:00Z')))
  })
  it('sends routine news and trades by push plus in-app, while excluding newsroom clickbait', async () => {
    const at = new Date('2026-11-01T17:00:00Z')
    const row = (id: string, title: string) => ({ id, sport: 'NFL', title, description: null,
      source: 'ESPN', sourceUrl: `https://www.espn.com/nfl/story/_/id/${id}`, team: null, publishedAt: at, fetchedAt: at })
    h.news.mockResolvedValue([
      row('1', 'Giants begin training camp'),
      row('2', 'Cardinals trade Marvin Harrison Jr. to Texans'),
      row('3', 'NFL Week 9 power rankings'),
    ])
    const result = await dispatchBreakingNewsAlerts({ now: new Date('2026-11-01T17:05:00Z') })
    expect(result.sent).toBe(2)
    const notices = h.dispatch.mock.calls.map(([arg]) => arg)
    expect(notices.map((n) => n.type).sort()).toEqual(['breaking_news', 'sports_news'])
    for (const notice of notices) expect(notice).toMatchObject({ userIds: ['fan'], category: 'breaking_news', skipChannels: { email: true, sms: true } })
    expect(notices.find((n) => n.type === 'sports_news')?.dedupePrefix).toBe(newsDeliveryKey('NFL', 'Giants begin training camp', at))
  })
})
