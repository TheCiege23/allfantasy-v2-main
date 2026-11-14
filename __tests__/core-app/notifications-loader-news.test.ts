// @vitest-environment node
/**
 * The notifications loader files sports news under its own "News" category and links each story
 * (2026-11-14). Before, a news alert classified as 'all', carried no action, and could not be opened.
 */
import { describe, expect, it, vi } from 'vitest'

const findMany = vi.fn()
vi.mock('@/lib/prisma', () => ({
  prisma: {
    platformNotification: {
      findMany: (...a: unknown[]) => findMany(...a),
      count: vi.fn(async () => 0),
    },
    discordLeagueChannel: { findFirst: vi.fn(async () => null) },
    leagueTeam: { findMany: vi.fn(async () => []) },
  },
}))

import { getNotificationsCenter } from '@/lib/core-app/notificationsCenter'

const stored = (id: string, type: string, meta: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id, type, title: 'NCAAB news', body: 'Iowa Hawkeyes square off against the Creighton Bluejays — via ESPN', severity: 'medium',
  createdAt: new Date('2026-11-14T09:00:00Z'), readAt: null, leagueId: null, meta, league: null, ...extra,
})

describe('getNotificationsCenter sports news', () => {
  it('files news under News, links the story, and counts it', async () => {
    findMany.mockResolvedValueOnce([
      stored('a', 'sports_news', { notificationCategory: 'breaking_news', sport: 'NCAAB', source: 'ESPN', sourceUrl: 'https://www.espn.com/story/1' }),
      stored('b', 'breaking_news', { notificationCategory: 'breaking_news', sport: 'NFL', source: 'ESPN', actionHref: 'https://www.espn.com/story/2' }),
      // No category stamped (an older row): the type alone decides.
      stored('c', 'sports_news', { sport: 'NHL', sourceUrl: 'https://www.nhl.com/story/3' }),
      // An unsafe stored URL gets no link at all.
      stored('d', 'sports_news', { notificationCategory: 'breaking_news', sport: 'NBA', sourceUrl: 'javascript:alert(1)' }),
      stored('e', 'trade_offer', { notificationCategory: 'trade_proposals' }, { title: 'New trade offer', leagueId: 'l1', league: { name: 'L', platform: 'sleeper', platformLeagueId: null, season: 2026 } }),
    ])
    const data = await getNotificationsCenter({ userId: 'u1', issues: [], now: new Date('2026-11-14T10:00:00Z') })
    const byId = Object.fromEntries(data.rest.map((r) => [r.id, r]))
    expect(byId.a.kind).toBe('news')
    expect(byId.a.action).toEqual({ label: 'Read on ESPN', href: 'https://www.espn.com/story/1', external: true })
    expect(byId.b.kind).toBe('news')
    expect(byId.b.action?.href).toBe('https://www.espn.com/story/2')
    expect(byId.c.kind).toBe('news')
    expect(byId.c.action).toEqual({ label: 'Read on nhl.com', href: 'https://www.nhl.com/story/3', external: true })
    expect(byId.d.kind).toBe('news')
    expect(byId.d.action).toBeNull()
    expect(byId.e.kind).toBe('trades')
    expect(byId.e.action?.external).toBe(false)
    expect(data.counts.news).toBe(4)
  })

  it('leaves player news about your own players where it was', async () => {
    findMany.mockResolvedValueOnce([
      stored('p', 'player_news_update', {}, { title: 'NYJ: player update', body: 'Garrett Wilson practiced in full' }),
    ])
    const data = await getNotificationsCenter({ userId: 'u1', issues: [], now: new Date('2026-11-14T10:00:00Z') })
    expect(data.rest[0].kind).toBe('all')
  })
})
