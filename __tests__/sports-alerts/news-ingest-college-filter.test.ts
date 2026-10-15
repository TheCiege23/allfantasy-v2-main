// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: { playerIdentityMap: { findMany: vi.fn().mockResolvedValue([]) } } }))

const { fetchESPNNewsForSport } = await import('@/app/api/sports/news/sync-helper')

const article = (headline: string, href: string) => ({ headline, description: '', links: { web: { href } }, categories: [] })

describe('ESPN news ingest', () => {
  it('drops college stories from a pro feed instead of filing them under that league', async () => {
    // ESPN's NHL feed on 2026-10-15 carried this college hockey story.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          articles: [
            article(
              'Arizona State hockey coach exits amid probe into collapse; Dave Hakstol hired',
              'https://www.espn.com/college-sports/story/_/id/50189567/arizona-state-hockey-coach-exits-amid-probe-collapse',
            ),
            article('Maple Leafs sign defenseman to extension', 'https://www.espn.com/nhl/story/_/id/1/maple-leafs-extension'),
          ],
        }),
      ),
    )
    const out = await fetchESPNNewsForSport('NHL')
    expect(out.map((a) => a.title)).toEqual(['Maple Leafs sign defenseman to extension'])
    expect(out[0].sport).toBe('NHL')
  })
})
