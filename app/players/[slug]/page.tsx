import type { Metadata } from 'next'
import { notFound, permanentRedirect } from 'next/navigation'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth'
import { getDashboardLeagueListForUser } from '@/lib/dashboard/get-dashboard-league-list'
import { getPlayerDetail, getRelatedPlayers, resolvePublicPlayer } from '@/lib/core-app/playerFinder'
import { parsePlayerSlug, playerPath, playerSlug } from '@/lib/core-app/playerSlug'
import { getPublicSiteOrigin } from '@/lib/site-public-origin'
import { getOgImageUrl } from '@/lib/seo/SocialShareMetadataService'
import Link from 'next/link'
import PlayerFinder from '@/components/core-app/screens/PlayerFinder'
import type { UserLeague } from '@/app/dashboard/types'

/**
 * `/players/{slug}` — the public, indexable Player Finder surface.
 *
 * This is the one screen in the signed-in product that has a reason to exist for
 * someone who is not signed in: a person searching a player's name should land on
 * a real page about that player, not on a login wall. So the page is served to
 * everyone, and the parts that are ABOUT YOUR LEAGUES are the only parts gated.
 *
 * ⚠ WHAT IS PUBLIC AND WHAT IS NOT, DELIBERATELY:
 *
 *   PUBLIC   name, position, team, number, bio, injury designation, season
 *            statistics, projection and positional rank. All of it is already
 *            public sports data — it is what every other fantasy site indexes,
 *            and none of it belongs to a user.
 *
 *   GATED    which of YOUR leagues roster him, the slot he sits in, per-league
 *            scoring, swap candidates off YOUR bench, and the verdict built on
 *            them. That is private league data and it renders only with a
 *            session, which the loaders enforce by needing a userId at all.
 *
 * ⚠ NOT `force-dynamic`. This is the one surface in the product whose value is
 * being cached and crawled, and the route-level default would make every crawl
 * hit Postgres. It revalidates instead — an injury designation changing an hour
 * late on a public page is not the same class of problem as it changing late on
 * the lineup screen a user is acting from.
 *
 * ⚠ ONE ROUTE, NOT A TREE. The repo sits against Vercel's 2048-route ceiling
 * (scripts/vercel-next-build.cjs), which is why the sport lives inside the slug
 * rather than being a `/players/{sport}/{name}` segment of its own.
 */
export const revalidate = 900

/*
 * Canonical origin from the shared helper, not a literal. Hardcoding the apex
 * here pointed every canonical, OG url and JSON-LD @id at a host that 307s to
 * www — see lib/site-public-origin.ts, which is the single source of truth.
 */
const SITE = getPublicSiteOrigin()

// The repo types route params as a Promise and awaits them: forward-compatible
// with Next 15, and awaiting a non-promise is a no-op on 14.
type Params = { params: Promise<{ slug: string }> }

/**
 * Resolve the slug once, shared by generateMetadata and the page body.
 *
 * Next dedupes identical fetches within a render but not identical Prisma calls,
 * so both entry points calling this would otherwise be two round trips per crawl.
 * React.cache is not used here because the two calls want different depths —
 * metadata needs only identity, the body needs the whole detail payload.
 */
async function resolveIdentity(slug: string) {
  const parts = parsePlayerSlug(slug)
  if (!parts) return null
  return resolvePublicPlayer(parts.sport, parts.sleeperId)
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const identity = await resolveIdentity(slug)
  if (!identity) {
    return {
      title: 'Player not found – AllFantasy',
      robots: { index: false, follow: true },
    }
  }

  const detail = await getPlayerDetail(identity.playerReference, [], null).catch(() => null)
  const player = detail?.player
  const canonicalSlug = playerSlug(identity) ?? slug

  const descriptor = [player?.position, player?.team].filter(Boolean).join(' · ')
  const title = descriptor
    ? `${identity.name} (${descriptor}) – Fantasy Stats, Injury & Projection – AllFantasy`
    : `${identity.name} – Fantasy Stats, Injury & Projection – AllFantasy`

  /*
   * The description is assembled from values we actually hold. A template that
   * always says "projected for X points" would print "projected for undefined
   * points" the moment the projection feed is behind, which is the search-result
   * snippet Google shows.
   */
  const bits: string[] = []
  /*
   * Prose, not the middot-joined chip string. `descriptor` is built for a
   * label row; dropped into a sentence it produced "Brock Purdy is a
   * Quarterback · San Francisco 49ers in NFL", which is what Google would have
   * shown as the snippet.
   */
  if (player?.position && player?.team) {
    bits.push(`${identity.name} is a ${player.position} for the ${player.team}.`)
  } else if (player?.position) {
    bits.push(`${identity.name} is a ${player.position} in ${identity.sport}.`)
  }
  if (detail?.projection.available) {
    bits.push(
      `Projected ${detail.projection.data.points.toFixed(1)} points in week ${detail.projection.data.week} under standard scoring.`
    )
  }
  /*
   * ⚠ ONLY AN ACTUAL DESIGNATION. `injury.status` carries "Active" for a healthy
   * player, and "Injury status: Active" in a search snippet reads as though
   * something is wrong with him. Only the designations that mean a fantasy
   * manager has a decision to make get said out loud.
   */
  const designation = detail?.injury.available ? detail.injury.data.status : null
  if (designation && !/^(active|healthy)$/i.test(designation.trim())) {
    bits.push(`Injury designation: ${designation}.`)
  }
  bits.push(
    'See his slot in every league you have connected on Sleeper, ESPN and Yahoo — AllFantasy is read-only.'
  )

  const description = bits.join(' ').slice(0, 300)
  const url = `${SITE}/players/${canonicalSlug}`

  return {
    title,
    description,
    alternates: { canonical: url },
    /*
     * ⚠ ALWAYS AN IMAGE, BECAUSE DECLARING `openGraph` REPLACES THE PARENT'S.
     * Next does not deep-merge metadata objects, so omitting `images` here left
     * a player with no headshot on file with NO og:image at all rather than
     * inheriting the site default. Most players do have a cutout; the ones that
     * do not were previewing as a bare text card.
     */
    openGraph: {
      type: 'profile',
      url,
      title,
      description,
      siteName: 'AllFantasy',
      images: [{ url: player?.imageUrl || getOgImageUrl(), alt: identity.name }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [player?.imageUrl || getOgImageUrl()],
    },
  }
}

export default async function PublicPlayerPage({ params }: Params) {
  const { slug } = await params
  const identity = await resolveIdentity(slug)
  if (!identity) notFound()

  /*
   * A player whose listed name changed keeps their page: the slug tail is the
   * identity and the head is decoration, so a stale head is a permanent redirect
   * to the current canonical URL rather than a 404. That is what stops an
   * already-indexed link from dying on a name correction, and it collapses the
   * "J. Jefferson" / "Justin Jefferson" variants onto one indexed URL.
   */
  const canonicalSlug = playerSlug(identity)
  if (canonicalSlug && canonicalSlug !== slug.toLowerCase()) {
    permanentRedirect(`/players/${canonicalSlug}`)
  }

  /*
   * The session is OPTIONAL here — this is the only screen in the product where
   * not having one is a supported state rather than a redirect. Signed in, the
   * per-league sections resolve for real; signed out, the loaders are handed no
   * league ids and no user, and report that they cannot cross-reference.
   */
  const session = (await getServerSession(authOptions as never).catch(() => null)) as {
    user?: { id?: string }
  } | null
  /*
   * ⚠ THE CATCH IS LOAD BEARING ON THIS ROUTE SPECIFICALLY. Everywhere else a
   * failing session read means "send them to /login", which is a fine outcome.
   * Here it must degrade to the signed-out page instead: this is the surface a
   * search engine and a first-time visitor hit, and a 500 on it costs us the
   * page in the index, not just one request.
   */
  const userId = typeof session?.user?.id === 'string' ? session.user.id : null

  let leagueIds: string[] = []
  if (userId) {
    const payload = await getDashboardLeagueListForUser(userId).catch(() => null)
    const leagues = (payload?.leagues ?? []) as unknown as UserLeague[]
    /*
     * `hasUnifiedRecord: false` rows are AF Legacy board snapshots from the
     * career import, not leagues you play — 543 of them on one production
     * account. Same filter /core and /dashboard apply, for the same reason.
     */
    leagueIds = leagues
      .filter((l) => (l as { hasUnifiedRecord?: boolean }).hasUnifiedRecord !== false)
      .map((l) => l.id)
  }

  const detail = await getPlayerDetail(identity.playerReference, leagueIds, userId).catch(() => null)
  if (!detail) notFound()

  const descriptor = [detail.player.position, detail.player.team].filter(Boolean).join(' · ')

  const related = await getRelatedPlayers(
    detail.player.sport,
    detail.player.team,
    detail.player.position,
    identity.sleeperId
  ).catch(() => [])

  /*
   * schema.org, emitted as JSON-LD rather than microdata so the markup stays out
   * of the component. `Person` and not `SportsTeam`/`Athlete`: Athlete is not in
   * the schema.org core vocabulary Google validates against, and an invalid type
   * drops the whole block rather than degrading.
   */
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Person',
        '@id': `${SITE}/players/${canonicalSlug ?? slug}#person`,
        name: detail.player.name,
        url: `${SITE}/players/${canonicalSlug ?? slug}`,
        ...(detail.player.imageUrl ? { image: detail.player.imageUrl } : {}),
        ...(detail.player.position ? { jobTitle: detail.player.position } : {}),
        ...(detail.bio.height ? { height: detail.bio.height } : {}),
        ...(detail.bio.weight ? { weight: detail.bio.weight } : {}),
        ...(detail.bio.college
          ? { alumniOf: { '@type': 'CollegeOrUniversity', name: detail.bio.college } }
          : {}),
        ...(detail.player.team
          ? { memberOf: { '@type': 'SportsTeam', name: detail.player.team } }
          : {}),
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: SITE },
          { '@type': 'ListItem', position: 2, name: 'Players', item: `${SITE}/players` },
          {
            '@type': 'ListItem',
            position: 3,
            name: detail.player.name,
            item: `${SITE}/players/${canonicalSlug ?? slug}`,
          },
        ],
      },
    ],
  }

  return (
    <>
      <script
        type="application/ld+json"
        // The payload is built from our own database values, not from request
        // input, and JSON.stringify escapes the string contents.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
      <div className="af-core af-pf-shell">
        {/*
          A crawler reads the first heading and the prose under it. The screen's
          own h1 is "Player Finder" and the player is h2, which is the order the
          handoff specifies; this line gives the page a sentence of indexable
          context that is true for every player, without inventing a number.
        */}
        <p className="af-pf-seo-intro">
          {descriptor ? `${detail.player.name} — ${descriptor}.` : detail.player.name}{' '}
          Slot, injury designation and projection across every fantasy league you have connected on
          Sleeper, ESPN and Yahoo. AllFantasy is read-only: we show you which league and which screen
          to make the change on.
        </p>

        <PlayerFinder
          query=""
          matches={[]}
          detail={detail}
          leagueCount={leagueIds.length}
          signedIn={Boolean(userId)}
        />

        {/*
          Same team, same position. This is the only outbound internal link on
          the page — without it every player page is a crawl leaf reachable only
          from the sitemap, and it is also the comparison a reader making a
          start/sit call actually wants.
        */}
        {related.length > 0 ? (
          <section className="af-pf-related" aria-labelledby="af-pf-related-h">
            <h2 className="af-label" id="af-pf-related-h">
              {descriptor
                ? `Other ${detail.player.position}s on ${detail.player.team}`
                : 'Related players'}
            </h2>
            <ul className="af-pf-related-list">
              {related.map((r) => {
                const href = playerPath(r)
                if (!href) return null
                return (
                  <li key={`${r.sport}-${r.sleeperId}`}>
                    <Link href={href} className="af-pf-related-link">
                      {r.name}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </section>
        ) : null}
      </div>
    </>
  )
}
