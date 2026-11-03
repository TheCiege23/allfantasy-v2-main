import type { Metadata } from 'next'
import Link from 'next/link'

import { prisma } from '@/lib/prisma'
import { playerPath } from '@/lib/core-app/playerSlug'
import { getPublicSiteOrigin } from '@/lib/site-public-origin'
import { getOgImageUrl } from '@/lib/seo/SocialShareMetadataService'
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-player-finder.css'

/**
 * `/players` — the public index the individual player pages hang off.
 *
 * ⚠ THIS EXISTS FOR CRAWL STRUCTURE, NOT DECORATION. Without it every
 * `/players/{slug}` page is reachable only from the sitemap: no page on the site
 * links to any of them, so they arrive with no internal link equity and no
 * context about how they relate. A hub that groups them by position is the
 * cheapest honest fix, and it is also the page a person who searched "fantasy
 * football players" should land on.
 *
 * Cached for an hour. The grouping changes when the ingest changes, which is
 * daily at most, and this is a page bots hit far more often than people.
 */
export const revalidate = 3600

/*
 * Canonical origin from the shared helper, not a literal. Hardcoding the apex
 * here pointed every canonical, OG url and JSON-LD @id at a host that 307s to
 * www — see lib/site-public-origin.ts, which is the single source of truth.
 */
const SITE = getPublicSiteOrigin()

/*
 * The fantasy-relevant positions, in the order a lineup is set. Everything else
 * in the ingest (OL, DB, LS and so on) is a real player and not someone anyone
 * starts, so listing them would bury the useful links under thousands of others.
 */
const POSITION_GROUPS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const
const SPORTS = ['NFL', 'NBA', 'NHL', 'MLB', 'NCAAF', 'NCAAB', 'SOCCER'] as const

/** Per group, not per page — six groups of this size is a browsable index. */
const PER_GROUP = 48

export const metadata: Metadata = {
  title: 'Fantasy Players by Sport – Stats, Injuries & Projections – AllFantasy',
  description:
    'Find NFL, NBA, NHL, MLB, college football, college basketball and soccer players. View available stats, injuries and projections.',
  alternates: { canonical: `${SITE}/players` },
  openGraph: {
    type: 'website',
    url: `${SITE}/players`,
    siteName: 'AllFantasy',
    title: 'Fantasy Players by Sport – AllFantasy',
    description:
      'Find players across seven sports and view available fantasy research.',
    /*
     * ⚠ DECLARING `openGraph` WITHOUT `images` DROPS THE SITE DEFAULT ENTIRELY.
     * Next REPLACES the openGraph object from a parent rather than deep-merging
     * it, so this page shipped with NO og:image at all — verified on production,
     * where /players returned no og:image tag while /tools-hub returned the
     * default. Any link to this page previewed as a bare text card.
     */
    images: [{ url: getOgImageUrl(), alt: 'AllFantasy' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Fantasy Players by Sport – AllFantasy',
    description:
      'Find players across seven sports and view available fantasy research.',
    images: [getOgImageUrl()],
  },
}

export default async function PlayersIndexPage() {
  /*
   * DISTINCT on sleeperId: one athlete has one row per ingest source, so
   * Justin Jefferson the WR would otherwise appear six times in the WR group.
   * The same filters the sitemap applies, for the same reasons — sleeperId is
   * what makes a player addressable, and a null team is a never-rostered row.
   *
   * ⚠ DO NOT ADD `status` TO THIS FILTER. It looks like the missing "is he
   * active" signal and it is not: the column is written per ingest source and
   * the sources disagree with reality. Measured — Ben Roethlisberger, retired
   * since 2022, is `Active` on the sleeper row; Bo Nix, a starting QB, is
   * `INACT` on the rolling_insights row and `Questionable` on the sleeper one.
   * A status filter therefore drops current starters and keeps retired players,
   * which is the exact opposite of the intent. `team` is the best signal we
   * actually have, so a handful of retired names in the index is the honest
   * cost of not silently hiding real players.
   */
  const rows = await prisma.sportsPlayer
    .findMany({
      where: {
        sport: 'NFL',
        sleeperId: { not: null },
        team: { not: null },
        position: { in: [...POSITION_GROUPS] },
      },
      distinct: ['sleeperId'],
      orderBy: [{ sleeperId: 'asc' }, { fetchedAt: 'desc' }],
      select: { name: true, sport: true, sleeperId: true, source: true, externalId: true, position: true, team: true },
    })
    .catch(() => [])

  const otherSports = await Promise.all(SPORTS.filter((sport) => sport !== 'NFL').map(async (sport) => ({
    sport,
    players: await prisma.sportsPlayer.findMany({
      where: { sport, source: 'rolling_insights', team: { not: null } },
      orderBy: [{ name: 'asc' }, { externalId: 'asc' }],
      take: PER_GROUP,
      select: { name: true, sport: true, sleeperId: true, source: true, externalId: true, position: true, team: true },
    }).catch(() => []),
  })))

  const grouped = POSITION_GROUPS.map((pos) => ({
    position: `NFL · ${pos}`,
    players: rows
      .filter((r) => r.position === pos)
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, PER_GROUP),
  })).concat(otherSports.map(({ sport, players }) => ({ position: sport, players })))
    .filter((g) => g.players.length > 0)

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE },
      { '@type': 'ListItem', position: 2, name: 'Players', item: `${SITE}/players` },
    ],
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
      <div className="af-core af-pf-shell af-pf-index">
        <h1 className="af-display af-pf-h1">Fantasy players</h1>
        <p className="af-pf-seo-intro">
          Browse NFL, NBA, NHL, MLB, NCAAF, NCAAB and soccer players. Each page shows the
          statistics, injury reports and projections currently available for that sport.
        </p>

        {grouped.length === 0 ? (
          <p className="af-pf-unavailable">
            No players are ingested right now. This is a read failure on our side, not an empty
            league.
          </p>
        ) : (
          grouped.map((group) => (
            <section key={group.position} className="af-pf-related" aria-labelledby={`pos-${group.position}`}>
              <h2 className="af-label" id={`pos-${group.position}`}>
                {group.position}
              </h2>
              <ul className="af-pf-related-list">
                {group.players.map((p) => {
                  const href = playerPath(p)
                  if (!href) return null
                  return (
                    <li key={`${p.sport}-${p.source ?? 'sleeper'}-${p.externalId ?? p.sleeperId}`}>
                      <Link href={href} className="af-pf-related-link">
                        {p.name}
                        <span className="af-pf-related-team">{p.team}</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </>
  )
}
