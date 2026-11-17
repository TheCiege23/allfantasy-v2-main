import { describe, expect, it } from 'vitest'
import { LEAGUE_TYPE_GUIDES, SPORT_GUIDES, blogGuideHref } from '@/lib/seo-landing/blog-guides'
import { LEAGUE_TYPE_SLUGS } from '@/lib/seo-landing/league-type-pages'
import { SPORT_SLUGS } from '@/lib/seo-landing/config'
import { buildBlogPostingJsonLd, blogPostImageUrl } from '@/lib/automated-blog/blogPostingSchema'
import { blogShareCardLabel } from '@/lib/automated-blog/blogShareCard'
import { serializeJsonLd } from '@/lib/seo/StructuredDataResolver'

/**
 * The blog was reachable only from /blog and the sitemap; posts carried no article data and no
 * share image. These pin the three pieces that fix it.
 */

describe('lander → guide links', () => {
  const all = [...Object.entries(LEAGUE_TYPE_GUIDES), ...Object.entries(SPORT_GUIDES)]

  it('only names landers that exist', () => {
    for (const key of Object.keys(LEAGUE_TYPE_GUIDES)) expect(LEAGUE_TYPE_SLUGS).toContain(key)
    for (const key of Object.keys(SPORT_GUIDES)) expect(SPORT_SLUGS).toContain(key)
  })

  it('every guide is a real-looking slug with a title, listed once per lander', () => {
    for (const [lander, guides] of all) {
      expect(guides!.length, lander).toBeGreaterThan(0)
      const slugs = guides!.map((g) => g.slug)
      expect(new Set(slugs).size, lander).toBe(slugs.length)
      for (const g of guides!) {
        expect(g.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
        expect(g.title.trim().length).toBeGreaterThan(10)
      }
    }
  })

  it('a format lander leads with its own guide', () => {
    expect(LEAGUE_TYPE_GUIDES.dynasty?.[0].slug).toBe('dynasty-fantasy-football-guide')
    expect(LEAGUE_TYPE_GUIDES.keeper?.[0].slug).toBe('keeper-league-guide')
    expect(LEAGUE_TYPE_GUIDES['best-ball']?.[0].slug).toBe('best-ball-fantasy-football')
    expect(LEAGUE_TYPE_GUIDES['salary-cap']?.[0].slug).toBe('salary-cap-fantasy-football')
    expect(LEAGUE_TYPE_GUIDES.idp?.[0].slug).toBe('idp-fantasy-football')
    expect(LEAGUE_TYPE_GUIDES.c2c?.[0].slug).toBe('campus-to-canton-fantasy-football')
    expect(LEAGUE_TYPE_GUIDES.survivor?.[0].slug).toBe('survivor-fantasy-league')
    expect(LEAGUE_TYPE_GUIDES.zombie?.[0].slug).toBe('zombie-fantasy-league')
    expect(LEAGUE_TYPE_GUIDES['big-brother']?.[0].slug).toBe('big-brother-fantasy-league')
    expect(SPORT_GUIDES['fantasy-football']?.map((g) => g.slug)).toContain('faab-fantasy-football')
    expect(SPORT_GUIDES['fantasy-football']?.[0].slug).toBe('how-to-start-a-fantasy-football-league')
    expect(blogGuideHref('keeper-league-guide')).toBe('/blog/keeper-league-guide')
  })

  it('does not link the posts still scheduled — a static lander would point at a 404', () => {
    const listed = all.flatMap(([, guides]) => guides!.map((g) => g.slug))
    for (const scheduled of ['fantasy-football-playoff-strategy', 'nfl-playoff-bracket-pool', 'march-madness-bracket-pool-guide']) {
      expect(listed).not.toContain(scheduled)
    }
  })
})

describe('BlogPosting structured data', () => {
  const base = {
    origin: 'https://www.allfantasy.ai',
    slug: 'keeper-league-guide',
    title: 'How Keeper Leagues Work: Who to Keep and What It Costs',
    description: 'How keeper leagues work.',
    category: 'draft_prep',
    tags: ['keeper league', 'fantasy football keepers', 42, ''],
    publishedAt: new Date('2026-11-15T19:47:08Z'),
    updatedAt: new Date('2026-11-15T19:50:00Z'),
  }

  it('describes the post, its dates, its image and its publisher', () => {
    const [posting, crumb] = buildBlogPostingJsonLd(base)
    expect(posting).toMatchObject({
      '@type': 'BlogPosting',
      headline: base.title,
      description: base.description,
      url: 'https://www.allfantasy.ai/blog/keeper-league-guide',
      mainEntityOfPage: { '@id': 'https://www.allfantasy.ai/blog/keeper-league-guide' },
      image: ['https://www.allfantasy.ai/blog/keeper-league-guide/opengraph-image'],
      datePublished: '2026-11-15T19:47:08.000Z',
      dateModified: '2026-11-15T19:50:00.000Z',
      articleSection: 'Draft Prep',
      // Non-strings and blanks in the stored tags are dropped, not stringified.
      keywords: 'keeper league, fantasy football keepers',
    })
    expect((posting.publisher as { name: string }).name).toBe('AllFantasy')
    expect(crumb).toMatchObject({
      '@type': 'BreadcrumbList',
      itemListElement: [
        { position: 1, name: 'Blog', item: 'https://www.allfantasy.ai/blog' },
        { position: 2, name: base.title, item: 'https://www.allfantasy.ai/blog/keeper-league-guide' },
      ],
    })
  })

  it('falls back to the last edit when a post has no publish date, and omits unknown fields', () => {
    const [posting] = buildBlogPostingJsonLd({ ...base, publishedAt: null, category: 'nope', tags: null })
    expect(posting.datePublished).toBe('2026-11-15T19:50:00.000Z')
    expect(posting).not.toHaveProperty('articleSection')
    expect(posting).not.toHaveProperty('keywords')
  })

  it('cannot break out of its script tag through a title', () => {
    const [posting] = buildBlogPostingJsonLd({ ...base, title: '</script><img onerror=alert(1)>' })
    expect(serializeJsonLd(posting)).not.toContain('</script>')
  })

  it('points at the same card the page serves as og:image', () => {
    expect(blogPostImageUrl('https://x.test', 'a-b')).toBe('https://x.test/blog/a-b/opengraph-image')
  })
})

describe('share card label', () => {
  it('reads the sport and category the way a reader says them', () => {
    expect(blogShareCardLabel('NFL', 'draft_prep')).toBe('NFL · Draft Prep')
    expect(blogShareCardLabel('SOCCER', 'weekly_strategy')).toBe('Soccer · Weekly Strategy')
    expect(blogShareCardLabel('NCAAF', 'bracket_strategy')).toBe('College Football · Bracket Strategy')
    expect(blogShareCardLabel('NHL', 'unknown')).toBe('NHL')
    expect(blogShareCardLabel('', null)).toBe('')
  })
})
