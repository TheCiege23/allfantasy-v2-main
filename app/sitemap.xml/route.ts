import { prisma } from '@/lib/prisma'
import { SPORT_SLUGS, TOOL_SLUGS } from '@/lib/seo-landing/config'
import { DISCOVERY_LEAGUES_SLUGS } from '@/lib/seo-landing/discovery-leagues-pages'
import { playerSlug } from '@/lib/core-app/playerSlug'

/*
 * Cached rather than recomputed per crawl. The player block below is a few
 * thousand rows, and a sitemap is fetched by every bot that finds robots.txt —
 * without this each one is a table scan.
 */
export const revalidate = 3600

/**
 * A sitemap has a hard 50,000-URL / 50MB ceiling per file, and we are nowhere
 * near it — but the player set is the only unbounded block here, so it is capped
 * explicitly rather than left to grow into a silent truncation by Google.
 */
const MAX_PLAYER_URLS = 20000

export async function GET() {
  const baseUrl = 'https://allfantasy.ai'

  const staticPages = [
    { path: 'blog', priority: '0.8', changefreq: 'weekly' },
    { path: '', priority: '1.0', changefreq: 'weekly' },
    { path: 'app', priority: '0.9', changefreq: 'weekly' },
    { path: 'bracket', priority: '0.9', changefreq: 'weekly' },
    { path: 'brackets', priority: '0.8', changefreq: 'weekly' },
    { path: 'af-legacy', priority: '0.8', changefreq: 'weekly' },
    { path: 'trade-analyzer', priority: '0.8', changefreq: 'weekly' },
    { path: 'mock-draft', priority: '0.7', changefreq: 'weekly' },
    { path: 'waiver-ai', priority: '0.7', changefreq: 'weekly' },
    { path: 'tools-hub', priority: '0.85', changefreq: 'weekly' },
    { path: 'chimmy', priority: '0.8', changefreq: 'weekly' },
    { path: 'zen', priority: '0.6', changefreq: 'weekly' },
    { path: 'meditation', priority: '0.6', changefreq: 'weekly' },
    { path: 'breathing', priority: '0.5', changefreq: 'weekly' },
    { path: 'horoscope', priority: '0.5', changefreq: 'weekly' },
    { path: 'pricing', priority: '0.5', changefreq: 'monthly' },
  ]

  const sportUrls = SPORT_SLUGS.map(
    (slug) => `<url>
    <loc>${baseUrl}/sports/${slug}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.75</priority>
  </url>`
  ).join('\n  ')

  const toolUrls = TOOL_SLUGS.map(
    (slug) => `<url>
    <loc>${baseUrl}/tools/${slug}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.75</priority>
  </url>`
  ).join('\n  ')

  const discoveryLeaguesUrls = DISCOVERY_LEAGUES_SLUGS.map(
    (slug) => `<url>
    <loc>${baseUrl}/${slug}/leagues</loc>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`
  ).join('\n  ')

  let blogUrls = ''
  try {
    const published = await prisma.blogArticle.findMany({
      where: { publishStatus: 'published' },
      select: { slug: true, updatedAt: true },
    })
    blogUrls = published
      .map(
        (a) => `<url>
    <loc>${baseUrl}/blog/${a.slug}</loc>
    <lastmod>${a.updatedAt.toISOString().slice(0, 10)}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`
      )
      .join('\n  ')
  } catch {
    // ignore
  }

  /*
   * Public player pages — `/players/{name}-{sport}-{sleeperId}`.
   *
   * ⚠ THE FILTERS ARE THE INDEXING POLICY, NOT A PERFORMANCE TWEAK.
   *
   *   sleeperId NOT NULL   is what makes a player addressable at all: the slug
   *                        is keyed on it, because a name is not a person (two
   *                        different NFL players are called Justin Jefferson)
   *                        and an externalId is a per-source row, not a person.
   *                        See lib/core-app/playerSlug.ts.
   *   team NOT NULL        keeps never-rostered rows out of the index. A page
   *                        about a player with no team, no stats and no injury
   *                        is a thin page, and thousands of them is the classic
   *                        way to get a whole section deprioritised rather than
   *                        just those pages.
   *
   * ⚠ DO NOT ADD `status` HERE. It reads like the missing "is he active" filter
   * and the sources disagree with reality: Ben Roethlisberger, retired since
   * 2022, is `Active` on his sleeper row, while Bo Nix — a starting QB — is
   * `INACT` on rolling_insights and `Questionable` on sleeper. Filtering on it
   * would drop current starters from the index and keep retired players in it.
   *
   * DISTINCT on sleeperId because one athlete has one row per ingest source —
   * Justin Jefferson the WR appears six times across sleeper, thesportsdb,
   * rolling_insights and backfill. Without it the sitemap would submit the same
   * canonical URL six times.
   */
  let playerUrls = ''
  try {
    const players = await prisma.sportsPlayer.findMany({
      where: { sleeperId: { not: null }, team: { not: null }, position: { not: null } },
      distinct: ['sleeperId'],
      orderBy: [{ sleeperId: 'asc' }, { fetchedAt: 'desc' }],
      take: MAX_PLAYER_URLS,
      select: { name: true, sport: true, sleeperId: true },
    })

    playerUrls = players
      .map((p) => playerSlug(p))
      .filter((slug): slug is string => Boolean(slug))
      .map(
        (slug) => `<url>
    <loc>${baseUrl}/players/${slug}</loc>
    <changefreq>daily</changefreq>
    <priority>0.7</priority>
  </url>`
      )
      .join('\n  ')
  } catch {
    // A sitemap that omits the player block still validates; one that 500s does
    // not get read at all.
  }

  const staticUrls = staticPages
    .map(
      (p) => `<url>
    <loc>${baseUrl}/${p.path}</loc>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`
    )
    .join('\n  ')

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${staticUrls}
  ${sportUrls}
  ${toolUrls}
  ${discoveryLeaguesUrls}
  ${blogUrls}
  ${playerUrls}
</urlset>`

  return new Response(sitemap, {
    headers: {
      'Content-Type': 'application/xml',
    },
  })
}
