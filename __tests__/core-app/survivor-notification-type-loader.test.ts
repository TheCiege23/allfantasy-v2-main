// @vitest-environment node
/**
 * The notifications loader passes a Survivor row's kind through as `survivorType` (for its icon),
 * from the stored `survivor:<kind>` type, and changes nothing else about the row.
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

const stored = (id: string, type: string, title: string) => ({
  id, type, title, body: 'Body', severity: 'medium',
  createdAt: new Date('2026-10-31T00:00:00Z'), readAt: null, leagueId: 'sv1',
  meta: { notificationCategory: 'league_announcements' },
  league: { name: 'Outcast Isles', platform: 'native', platformLeagueId: null, season: 2026 },
})

describe('getNotificationsCenter survivorType', () => {
  it('sets it from survivor:<kind> and leaves every other row without it', async () => {
    findMany.mockResolvedValueOnce([
      stored('a', 'survivor:idol_found', 'You found a hidden idol'),
      stored('b', 'survivor:commissioner_chimmy_weekly_report', 'Chimmy’s weekly report'),
      stored('c', 'trade_offer', 'New trade offer'),
    ])
    const data = await getNotificationsCenter({ userId: 'u1', issues: [], leagueId: 'sv1', now: new Date('2026-10-31T01:00:00Z') })
    const byId = Object.fromEntries(data.rest.map((r) => [r.id, r]))
    expect(byId.a.survivorType).toBe('idol_found')
    expect(byId.b.survivorType).toBe('commissioner_chimmy_weekly_report')
    expect(byId.c).not.toHaveProperty('survivorType')
    // The rest of the row is decided as before.
    expect(byId.a.title).toBe('You found a hidden idol')
    expect(byId.a.kind).toBe('commissioner') // league_announcements → the Commissioner chip, unchanged
    expect(byId.a.category).toBe('league_announcements')
  })
})
