import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getPublicLeagueStandings } from '@/lib/core-app/publicStandings'
import './public-standings.css'

/**
 * Public league standings — `/standings/{leagueId}`.
 *
 * ⚠ THE ONLY INDEXABLE SURFACE IN THE 38a SUITE, AND THE ONLY ONE THAT SHOULD
 * BE. Every `/core` tab is `noindex, nofollow` because it is a signed-in
 * dashboard. A standings table is the one thing about a league worth a URL a
 * league-mate can open without an account.
 *
 * ⚠ NOT UNDER `/league/*`. That prefix is auth-gated in
 * `lib/auth/session-auth-paths.ts` and must stay that way; a public page there
 * would either be unreachable or would require punching a hole in the gate.
 * `/standings/*` is a separate, deliberately public namespace.
 *
 * ⚠ 404, NEVER 403, FOR A LEAGUE THAT HAS NOT OPTED IN. `getPublicLeagueStandings`
 * returns null for "no such league", "not published", "no platform id" and
 * "nothing scored" alike, so the response cannot be used to discover which
 * league ids exist.
 *
 * ⚠ ONE ROUTE. This repo hit Vercel's 2048-route cap at 2049 and had to exclude
 * whole directories to get back under it. This is a single dynamic page and
 * needs no API route — the commissioner's publish toggle rides the existing
 * `PATCH /api/league/settings` `settingsMerge` path.
 */

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ leagueId: string }> }

export async function generateMetadata({ params }: Params) {
  const { leagueId } = await params
  const data = await getPublicLeagueStandings(leagueId).catch(() => null)

  if (!data) {
    /*
     * An unpublished league gets no descriptive metadata AND `noindex`. Leaking
     * a real league name into a title on a page that then 404s would defeat the
     * point of the 404.
     */
    return { title: 'Standings · AllFantasy', robots: { index: false, follow: false } }
  }

  const title = `${data.leagueName} standings · ${data.season} · AllFantasy`
  const description = `${data.teams.length}-team fantasy standings for ${data.leagueName}, ${data.season} season through week ${data.week}. Ranked by points scored.`

  return {
    title,
    description,
    // The one place in this suite where indexing is wanted.
    robots: { index: true, follow: true },
    alternates: { canonical: `/standings/${leagueId}` },
    openGraph: { title, description, type: 'website' },
    twitter: { card: 'summary', title, description },
  }
}

export default async function PublicStandingsPage({ params }: Params) {
  const { leagueId } = await params
  const data = await getPublicLeagueStandings(leagueId).catch(() => null)

  if (!data) notFound()

  /*
   * Structured data so the table is machine-readable rather than just visible.
   * `ItemList` is the honest schema here — this is a ranked list of teams, and
   * claiming `SportsEvent` would describe something the page does not contain.
   */
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `${data.leagueName} standings`,
    numberOfItems: data.teams.length,
    itemListOrder: 'https://schema.org/ItemListOrderDescending',
    itemListElement: data.teams.map((t) => ({
      '@type': 'ListItem',
      position: t.rank,
      name: t.name,
    })),
  }

  return (
    <main className="ps">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger -- JSON-LD has no HTML in it; the
        // payload is our own serialised object, not user markup.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <header className="ps-head">
        <p className="ps-eyebrow">Fantasy standings</p>
        <h1 className="ps-title">{data.leagueName}</h1>
        <p className="ps-sub">
          {data.season} season ·{' '}
          {data.seasonComplete ? `final, after week ${data.week}` : `through week ${data.week}`} ·{' '}
          {data.teams.length} teams
        </p>
      </header>

      <div className="ps-tablewrap">
        <table className="ps-table">
          <caption className="ps-caption">
            Ranked by total points scored across {data.scoredWeeks}{' '}
            {data.scoredWeeks === 1 ? 'scored week' : 'scored weeks'}. Record is shown alongside,
            since points and record often disagree.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="ps-rankcol">
                #
              </th>
              <th scope="col">Team</th>
              <th scope="col" className="ps-n">
                Points for
              </th>
              <th scope="col" className="ps-n">
                Per week
              </th>
              <th scope="col" className="ps-n">
                Record
              </th>
            </tr>
          </thead>
          <tbody>
            {data.teams.map((t) => (
              <tr key={`${t.rank}-${t.name}`}>
                <td className="ps-rankcol ps-n">{t.rank}</td>
                <th scope="row" className="ps-name">
                  {t.name}
                </th>
                <td className="ps-n">{t.pointsFor.toFixed(1)}</td>
                <td className="ps-n">{t.average != null ? t.average.toFixed(1) : '—'}</td>
                <td className="ps-n">
                  {t.wins}—{t.losses}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <footer className="ps-foot">
        <p>
          Published by this league&apos;s commissioner. AllFantasy reads league data and never
          changes it.
        </p>
        <p>
          <Link href="/core">Your own leagues</Link> ·{' '}
          <Link href="/">What AllFantasy does</Link>
        </p>
      </footer>
    </main>
  )
}
