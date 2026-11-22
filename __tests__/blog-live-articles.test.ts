/**
 * Blog articles that are LIVE (lib/automated-blog/liveArticles.ts), and the two places an empty blog
 * used to be advertised to Google.
 *
 *   1. Scheduled posts never went live: `scheduleArticle` stores "scheduled" + a future date, nothing
 *      ever flipped it, and every reader filtered on "published".
 *   2. Production had zero articles, yet the sitemap listed /blog at 0.8 and the page said index.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const blogFindMany = vi.fn()
const blogCount = vi.fn()
const playerFindMany = vi.fn()
vi.mock('@/lib/prisma', () => ({
  prisma: {
    blogArticle: { findMany: (...a: unknown[]) => blogFindMany(...a), count: (...a: unknown[]) => blogCount(...a) },
    sportsPlayer: { findMany: (...a: unknown[]) => playerFindMany(...a) },
  },
}))

import { isArticleLive, liveArticleWhere } from '@/lib/automated-blog/liveArticles'

const ROOT = resolve(__dirname, '..')
const NOW = new Date('2026-11-15T12:00:00Z')
const HOUR = 3_600_000

afterEach(() => {
  blogFindMany.mockReset()
  blogCount.mockReset()
  playerFindMany.mockReset()
  vi.spyOn(console, 'error').mockRestore()
})

describe('isArticleLive / liveArticleWhere', () => {
  it('published is live; a scheduled post is live once its time has passed, not before', () => {
    expect(isArticleLive({ publishStatus: 'published', publishedAt: null }, NOW)).toBe(true)
    expect(isArticleLive({ publishStatus: 'scheduled', publishedAt: new Date(NOW.getTime() - HOUR) }, NOW)).toBe(true)
    expect(isArticleLive({ publishStatus: 'scheduled', publishedAt: NOW }, NOW)).toBe(true)
    expect(isArticleLive({ publishStatus: 'scheduled', publishedAt: new Date(NOW.getTime() + HOUR) }, NOW)).toBe(false)
    expect(isArticleLive({ publishStatus: 'scheduled', publishedAt: null }, NOW)).toBe(false)
    expect(isArticleLive({ publishStatus: 'draft', publishedAt: new Date(NOW.getTime() - HOUR) }, NOW)).toBe(false)
  })

  it('the query fragment encodes the same rule', () => {
    expect(liveArticleWhere(NOW)).toEqual({
      OR: [{ publishStatus: 'published' }, { publishStatus: 'scheduled', publishedAt: { lte: NOW } }],
    })
  })

  it('no public reader filters on "published" alone any more', () => {
    // Line-anchored so a comment that DESCRIBES the old filter cannot trip it.
    const readers = [
      'app/blog/page.tsx',
      'app/blog/[slug]/page.tsx',
      'app/api/blog/slug/[slug]/route.ts',
      'app/sitemap.xml/route.ts',
      'lib/content-feed/FeedAggregationService.ts',
    ]
    for (const f of readers) {
      const code = readFileSync(resolve(ROOT, f), 'utf8')
        .split('\n')
        .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
        .join('\n')
      expect(code, f).not.toMatch(/publishStatus\s*(:|===|!==)\s*['"]published['"]/)
    }
  })
})

async function sitemapText(): Promise<string> {
  const { GET } = await import('@/app/sitemap.xml/route')
  return (await GET()).text()
}

describe('sitemap blog entries', () => {
  it('an empty blog lists neither /blog nor any article', async () => {
    playerFindMany.mockResolvedValue([])
    blogFindMany.mockResolvedValue([])
    const xml = await sitemapText()
    expect(xml).not.toContain('/blog<')
    expect(xml).not.toContain('/blog/')
    // Positive control: the rest of the sitemap still rendered.
    expect(xml).toContain('/league-types<')
  })

  it('a live article lists /blog and the article, and asks for live rows (not "published" only)', async () => {
    playerFindMany.mockResolvedValue([])
    blogFindMany.mockResolvedValue([
      { slug: 'week-12-waivers', updatedAt: new Date('2026-11-10T00:00:00Z'), publishedAt: new Date('2026-11-14T09:00:00Z') },
    ])
    const xml = await sitemapText()
    expect(xml).toContain('/blog</loc>')
    expect(xml).toContain('/blog/week-12-waivers</loc>')
    // A scheduled post changed when it went live, not when it was scheduled.
    expect(xml).toContain('<lastmod>2026-11-14</lastmod>')
    const where = blogFindMany.mock.calls[0]?.[0]?.where
    expect(where?.OR).toHaveLength(2)
  })

  it('a failed query keeps /blog listed and is logged, not swallowed', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    playerFindMany.mockResolvedValue([])
    blogFindMany.mockRejectedValue(new Error('db down'))
    const xml = await sitemapText()
    expect(xml).toContain('/blog</loc>')
    expect(xml).not.toContain('/blog/')
    expect(err).toHaveBeenCalled()
  })
})

describe('/blog robots tag', () => {
  it('is noindex while no article is live, index once one is, and index if the count fails', async () => {
    const { generateMetadata } = await import('@/app/blog/page')
    blogCount.mockResolvedValueOnce(0)
    expect((await generateMetadata()).robots).toEqual({ index: false, follow: true })
    blogCount.mockResolvedValueOnce(3)
    expect((await generateMetadata()).robots).toEqual({ index: true, follow: true })
    blogCount.mockRejectedValueOnce(new Error('db down'))
    expect((await generateMetadata()).robots).toEqual({ index: true, follow: true })
  })
})
