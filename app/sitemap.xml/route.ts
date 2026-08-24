import { prisma } from '@/lib/prisma'
import { SPORT_SLUGS, TOOL_SLUGS } from '@/lib/seo-landing/config'
import { DISCOVERY_LEAGUES_SLUGS } from '@/lib/seo-landing/discovery-leagues-pages'
import { playerSlug } from '@/lib/core-app/playerSlug'
import { getPublicSiteOrigin } from '@/lib/site-public-origin'

/*
 * ⚠ force-dynamic, AND `revalidate` HERE WAS A LIVE BUG. Adding `revalidate`
 * alone made this route STATICALLY PRERENDERED at build time, where Prisma has
 * no database to talk to — so the player query returned nothing, the fail-soft
 * catch below swallowed it, and production served a sitemap with 40 static URLs
 * and ZERO of the 3,242 player pages it was added to publish. It failed exactly
 * as designed: silently, with a valid document.
 *
 * Confirmed on production before changing it: the route answered
 * `X-Vercel-Cache: HIT` even for a URL with a cache-busting query string, which
 * a dynamic route cannot do — it was fully static.
 *
 * Rendering per request restores database access. The CDN cache is kept via the
 * Cache-Control header on the response instead, so a crawl still does not cost a
 * query per bot.
 */
export const dynamic = 'force-dynamic'

/**
 * A sitemap has a hard 50,000-URL / 50MB ceiling per file, and we are nowhere
 * near it — but the player set is the only unbounded block here, so it is capped
 * explicitly rather than left to grow into a silent truncation by Google.
 */
const MAX_PLAYER_URLS = 20000

export async function GET() {
  /*
   * ⚠ THE APEX WAS WRONG, AND IT MADE EVERY URL IN THIS FILE POINT AT A REDIRECT.
   * lib/site-public-origin.ts defines the canonical origin as
   * https://www.allfantasy.ai ("default www", in its own comment), and the apex
   * 307s to it — so all 3,242 player URLs and every static entry here were
   * submitted as redirects. Read from the helper so this file cannot drift from
   * the host the app actually serves and redirects to.
   */
  const baseUrl = getPublicSiteOrigin()

  const staticPages = [
    { path: 'blog', priority: '0.8', changefreq: 'weekly' },
    { path: '', priority: '1.0', changefreq: 'weekly' },
    /*
     * The Spanish landing. It is a distinct indexable document with its own
     * canonical — not a variant of `/` — so it needs its own entry here or the
     * only way a crawler reaches it is the hreflang on the English page.
     * Lower priority than `/` because English is x-default.
     */
    { path: 'es', priority: '0.9', changefreq: 'weekly' },
    { path: 'app', priority: '0.9', changefreq: 'weekly' },
    /*
     * ⚠ /bracket (singular) IS DELIBERATELY ABSENT. It 307s to /brackets —
     * measured — so this was the highest-priority static entry in the whole
     * sitemap after the homepage, 0.9, pointing at a redirect. Its layout
     * builds real metadata via getSEOPageConfig('bracket-challenge'), and none
     * of it can reach a crawler for the same reason /mock-draft's cannot: the
     * redirect answers first. The destination /brackets is listed below at 0.8
     * and now carries its own canonical, and /tools/bracket-challenge is the
     * public landing page for the phrase.
     */
    { path: 'brackets', priority: '0.8', changefreq: 'weekly' },
    { path: 'af-legacy', priority: '0.8', changefreq: 'weekly' },
    { path: 'trade-analyzer', priority: '0.8', changefreq: 'weekly' },
    /*
     * ⚠ /mock-draft IS DELIBERATELY ABSENT, for a blunter reason than /waiver-ai
     * below it. app/mock-draft/page.tsx calls redirect('/login?callbackUrl=...')
     * for any visitor without a session, so a crawler fetching this URL gets a
     * 307 and no document — measured. Its `metadata` block is real but only ever
     * names the browser tab for a signed-in user; it cannot reach a search
     * engine. Submitting the URL anyway asked Google to crawl a redirect at
     * priority 0.7. /tools/mock-draft-simulator is the public page for this
     * tool, is 200, and stays in the sitemap.
     */
    /*
     * ⚠ /waiver-ai IS DELIBERATELY ABSENT. It carried the SAME title,
     * description and keywords as /tools/waiver-wire-advisor — byte for byte,
     * from two hand-written config copies — while serving signed-out visitors
     * 501 chars whose h1 reads "Sign in to analyze your leagues", against that
     * page's 2066 chars of real copy. Two sitemap'd URLs cannot both win one
     * query, and the login wall is the wrong one to enter. The app route is
     * noindex,follow now (app/waiver-ai/layout.tsx); the landing page below
     * owns the phrase and its CTA opens /waiver-ai.
     */
    { path: 'tools-hub', priority: '0.85', changefreq: 'weekly' },
    { path: 'chimmy', priority: '0.8', changefreq: 'weekly' },
    { path: 'pricing', priority: '0.5', changefreq: 'monthly' },
    // Spanish pricing — its own canonical and hreflang, so it needs its own entry.
    { path: 'es/pricing', priority: '0.5', changefreq: 'monthly' },
    /*
     * The legal and company pages. None of the eight was published here, which
     * is the kind of omission that stays invisible until it is urgent: app
     * store submissions, payment processors and OAuth provider reviews all go
     * looking for a reachable Terms and Privacy, and "it is linked from the
     * footer" is a weaker answer than "it is in the sitemap".
     *
     * Low priority on purpose. They should be indexed and findable by name, not
     * competing with the product pages — and every one of them now declares its
     * own canonical, so the `?from=signup&next=...` variants the signup form
     * links to consolidate onto these addresses rather than multiplying.
     */
    { path: 'terms', priority: '0.3', changefreq: 'yearly' },
    { path: 'privacy', priority: '0.3', changefreq: 'yearly' },
    { path: 'disclaimer', priority: '0.3', changefreq: 'yearly' },
    { path: 'no-gambling-policy', priority: '0.3', changefreq: 'yearly' },
    { path: 'ai-transparency', priority: '0.3', changefreq: 'yearly' },
    { path: 'data-deletion', priority: '0.3', changefreq: 'yearly' },
    { path: 'mission', priority: '0.4', changefreq: 'monthly' },
    { path: 'contact', priority: '0.4', changefreq: 'monthly' },
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
      /*
       * The caching `revalidate` used to provide, without the build-time
       * prerender that broke it. s-maxage is what Vercel's CDN honours;
       * stale-while-revalidate keeps a crawl fast while a new copy is built.
       */
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  })
}
