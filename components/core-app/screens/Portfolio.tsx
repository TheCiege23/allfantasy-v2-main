'use client'

import { useState } from 'react'
import Link from 'next/link'
import { LeagueInvitePanel } from '@/components/core-app/LeagueInvitePanel'
import type { PortfolioData, PortfolioLeague } from '@/lib/core-app/portfolio'
import type { PortfolioInsights, RecordedValueDay } from '@/lib/core-app/portfolioInsightsTypes'
import { EMPTY_FILTER, type LineupSignal, type PortfolioFilter } from '@/lib/core-app/portfolioView'
import { PortfolioBoard, type PortfolioViewKey } from '@/components/core-app/portfolio/PortfolioBoard'
import '@/components/core-app/af-portfolio.css'
import '@/components/core-app/af-core-boards.css'

/**
 * Portfolio — every league you are in.
 *
 * ⚠ THIS SLOT WAS A "NOT BUILT YET" PLACEHOLDER IN THE PRIMARY NAV. Three of the
 * five rail items rendered an apology, and this was one of them. It is also the
 * single biggest blocker to retiring /dashboard: home is a queue that takes a
 * league COUNT, so without this a user with sixty leagues would have no way to
 * see them.
 *
 * ⚠ THE ROW LINKS TO THE LEAGUE, NOT TO A MODAL. The old dashboard opened a
 * detail modal; a link is addressable, shareable and survives a refresh.
 *
 * ⚠ AND IT LINKS INTO /core, NOT TO /league/{id}. This row pointed at the legacy
 * league page, so the primary way into a league from the new shell landed on the
 * exact surface /core exists to replace — the first ESPN league ever imported
 * opened there, which is how this was found.
 *
 * `/core?league={id}` renders LeagueHome: `activeKey` falls back to 'home' with
 * no path segment, and `selectedLeagueId` reads the `league` search param.
 */

/**
 * How each platform is named to a person. The row chip prints the raw key, which is
 * fine as a mark but wrong as a heading — "mfl" is not a word.
 */
/**
 * One or two letters standing in for a league with no avatar.
 *
 * Two initials when the name has separate words ("Beta 1 Zombie League" -> BZ,
 * skipping the digit), otherwise the first two characters ("KBFL" -> KB), so a
 * single-word name still reads as a mark rather than one lonely letter.
 */
function leagueMonogram(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => /[a-z]/i.test(w))
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return (words[0] ?? name).slice(0, 2).toUpperCase()
}

const PLATFORM_LABEL: Record<string, string> = {
  sleeper: 'Sleeper',
  espn: 'ESPN',
  yahoo: 'Yahoo',
  fantrax: 'Fantrax',
  mfl: 'MyFantasyLeague',
  fleaflicker: 'Fleaflicker',
  manual: 'Manual',
  native: 'AllFantasy',
}

export type PortfolioProps = {
  data: PortfolioData
  /**
   * The cross-league board's data (lib/core-app/portfolioInsights.ts), read through its summary.
   * Null when the build failed — the inventory list still renders, and says the board is missing.
   */
  insights?: PortfolioInsights | null
  /** When `insights` was built, and whether this is a stored copy served while it refreshes. */
  insightsBuiltAt?: string | null
  insightsStale?: boolean
  recorded?: RecordedValueDay[]
  /** The home loader's lineup counts per league id; null when that read failed. */
  lineup?: Record<string, LineupSignal> | null
  /** Request-scoped: favourites live in a per-device cookie, paid leagues on the league list. */
  favoriteIds?: string[]
  paidIds?: string[]
  initialFilter?: PortfolioFilter
  initialView?: PortfolioViewKey
  /** Where "import a league" should go — carries the return path. */
  importHref?: string
}

export function Portfolio({
  data,
  insights = null,
  insightsBuiltAt = null,
  insightsStale = false,
  recorded = [],
  lineup = null,
  favoriteIds = [],
  paidIds = [],
  initialFilter = EMPTY_FILTER,
  initialView = 'overview',
  importHref = '/import?returnTo=%2Fcore%2Fportfolio',
}: PortfolioProps) {
  if (!data.leagues.available) {
    return (
      <div className="af-pf">
        <header className="af-pf-head">
          <h1 className="af-pf-title">Portfolio</h1>
        </header>
        <div className="af-pf-empty">
          <p className="af-pf-empty-title">{data.leagues.reason}</p>
          <div className="af-pf-empty-actions">
            <Link href={importHref} className="af-pf-btn af-pf-btn--primary">
              Import a league
            </Link>
            <Link href="/create-league" className="af-pf-btn">
              Create one from scratch
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const leagues = data.leagues.data

  return (
    <div className="af-pf">
      <header className="af-pf-head">
        <div>
          <h1 className="af-pf-title">Portfolio</h1>
          {/*
            ⚠ "CLAIMED TEAMS", NOT "LEAGUES", AND THE DIFFERENCE IS REAL. This
            screen is one row per team you have CLAIMED — `getPortfolio` reads
            `LeagueTeam WHERE claimedByUserId`. A league with no claimed team is
            absent however healthy its import, and two claimed teams in one
            league render as two rows BY DESIGN (a 32-team league is often two
            conferences). Calling the count "leagues" is what makes both of those
            look like bugs.
          */}
          <p className="af-pf-sub">
            {leagues.length} claimed {leagues.length === 1 ? 'team' : 'teams'}
            {data.commissionedCount > 0 ? ` · you commission ${data.commissionedCount}` : ''}
          </p>
        </div>
        <Link href={importHref} className="af-pf-btn">
          Import a league
        </Link>
      </header>

      {insights && insights.leagues.length > 0 ? (
        <PortfolioBoard
          insights={insights}
          recorded={recorded}
          lineup={lineup}
          extras={{ favoriteIds, paidIds }}
          initialFilter={initialFilter}
          initialView={initialView}
          builtAt={insightsBuiltAt}
          servedStale={insightsStale}
          renderLeagues={(ids, filtered) => (
            <LeagueList
              leagues={filtered ? leagues.filter((l) => ids.has(l.leagueId)) : leagues}
              total={leagues.length}
              filtered={filtered}
              importHref={importHref}
            />
          )}
        />
      ) : (
        <>
          <div className="af-pf-risk-empty">
            <strong>The cross-league board could not be built just now.</strong>
            <span>Your leagues are listed below. Exposure, risk and value movement will return on the next load.</span>
          </div>
          <LeagueList leagues={leagues} total={leagues.length} filtered={false} importHref={importHref} />
        </>
      )}
    </div>
  )
}

/**
 * The inventory — every claimed team, grouped by platform.
 *
 * ⚠ GROUPED BECAUSE SIXTY OF ONE PLATFORM BURIES ONE OF ANOTHER. A single
 * alphabetical list put the first Fantrax league ever imported between "Bla bla
 * bla" and "Fathers Day-Dads Dynasty", where it was reported as missing while it
 * was on screen. Rows keep the order the service sorted them into (commissioner
 * first, then alphabetical) INSIDE each group.
 *
 * ⚠ THE PLATFORM TABS THAT USED TO SIT HERE MOVED INTO THE BOARD'S FILTERS, which
 * scope every view at once. Two platform controls on one screen that disagreed
 * about what was selected would be worse than either.
 */
function LeagueList({
  leagues,
  total,
  filtered,
  importHref,
}: {
  leagues: PortfolioLeague[]
  total: number
  filtered: boolean
  importHref: string
}) {
  /*
   * ⚠ ONE OPEN AT A TIME, AND FETCHED ONLY WHEN OPENED. One production account
   * commissions 40 leagues. Rendering an invite panel per row would fire forty
   * simultaneous requests to /api/leagues/join on page load, for links nobody
   * asked to see. The panel fetches on mount, so not mounting it IS the guard.
   */
  const [openInvite, setOpenInvite] = useState<string | null>(null)

  /*
   * Biggest group first so the platform someone actually lives in leads, with an
   * alphabetical tiebreak so equal-sized groups do not reshuffle between visits.
   */
  const groups = (() => {
    const by = new Map<string, PortfolioLeague[]>()
    for (const l of leagues) {
      const key = (l.platform || 'manual').toLowerCase()
      const bucket = by.get(key)
      if (bucket) bucket.push(l)
      else by.set(key, [l])
    }
    return [...by.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
  })()

  return (
    <>
      {groups.map(([platform, rows]) => (
        <section key={platform} className="af-pf-group">
          <header className="af-pf-group-head">
            <span className="af-pf-group-name" data-platform={platform}>
              {PLATFORM_LABEL[platform] ?? platform}
            </span>
            <span className="af-pf-group-count">
              {rows.length} {rows.length === 1 ? 'league' : 'leagues'}
            </span>
            <span className="af-pf-group-rule" aria-hidden />
          </header>
          <ul className="af-pf-list">
        {rows.map((l) => (
          <li key={l.leagueId} className="af-pf-item">
            <Link href={`/core?league=${l.leagueId}`} className="af-pf-row">
              {/*
                ⚠ NO ARTWORK ELEMENT EXISTED AT ALL, which is why no league image
                has ever rendered here — the field was never selected and nothing
                would have drawn it if it had been.

                ⚠ A MONOGRAM, NOT A PLACEHOLDER IMAGE. 67 of 115 leagues have no
                avatar on the platform, so a missing one is the COMMON case, not
                a failure — a broken-image glyph on more than half the rows would
                read as the page being broken. The initial is derived from the
                name we already show, so it is never wrong.

                A CDN url that 404s removes itself and reveals the same monogram
                beneath, the way the comms drawer handles player headshots.
              */}
              <span className="af-pf-row-art" aria-hidden data-platform={(l.platform || 'manual').toLowerCase()}>
                <span className="af-pf-art-mark">{leagueMonogram(l.leagueName)}</span>
                {l.avatarUrl ? (
                  <img
                    className="af-pf-art-img"
                    src={l.avatarUrl}
                    alt=""
                    loading="lazy"
                    onError={(e) => {
                      e.currentTarget.remove()
                    }}
                  />
                ) : null}
              </span>

              <span className="af-pf-row-main">
                <span className="af-pf-row-name">
                  {l.isCommissioner ? (
                    <span className="af-pf-commish" title="You commission this league">
                      ★
                    </span>
                  ) : null}
                  {l.leagueName}
                </span>
                <span className="af-pf-row-meta">
                  <span className="af-pf-platform" data-platform={(l.platform || 'manual').toLowerCase()}>
                    {l.platform}
                  </span>
                  <span>{l.sport}</span>
                  {l.season ? <span>{l.season}</span> : null}
                </span>
              </span>

              <span className="af-pf-row-team">
                {l.team ? (
                  <>
                    <span className="af-pf-team-name">{l.team.name}</span>
                    {/*
                      ⚠ A RANK WITHOUT A RECORD IS NOT A STANDING, AND SHOWING BOTH
                      READ AS A CONTRADICTION: "no record yet · #6 of 18". Seen on
                      production across most of a 60-league portfolio. If no games
                      have been played, currentRank is draft order or a seed, not a
                      position earned — so it is withheld and only the league size
                      is stated, which is true either way.
                    */}
                    <span className="af-pf-team-meta af-num">
                      {l.team.record
                        ? `${l.team.record}${
                            l.team.rank != null && l.team.rank > 0
                              ? ` · #${l.team.rank}${l.team.teamCount ? ` of ${l.team.teamCount}` : ''}`
                              : ''
                          }`
                        : l.team.teamCount
                          ? `${l.team.teamCount}-team league · no record imported`
                          : 'no record imported'}
                    </span>
                  </>
                ) : (
                  <span className="af-pf-team-meta">team not identified</span>
                )}
              </span>

              {/*
                ⚠ THREE DISTINCT STATES, NOT A NUMBER THAT CAN BE ZERO. A bare "0"
                reads as a broken row. Measured on production: 70 of 200 rosters
                genuinely hold no players, so this is common enough that getting
                the wording right matters more than the count does.

                ⚠ AND IT SAYS WHOSE ROSTER. This read "8 players" directly beside
                "20-team league", so the owner reported it as a wrong player
                count — reasonably, since two numbers about the same league that
                disagree by an order of magnitude look like a bug. The count was
                always THEIR roster; only the label was ambiguous.
              */}
              <span className="af-pf-row-roster">
                {l.rosterCount == null ? (
                  <span className="af-pf-roster-none">no roster imported</span>
                ) : l.rosterCount === 0 ? (
                  <span className="af-pf-roster-none">no roster data</span>
                ) : (
                  <span className="af-num">
                    {l.rosterCount} on your roster
                  </span>
                )}
              </span>
            </Link>

            {/*
              Invites belong to whoever runs the league, so the control only
              exists on rows where you do. Before this, the only place a
              commissioner could get an invite link was inside the dashboard we
              are retiring.
            */}
            {l.isCommissioner ? (
              <div className="af-pf-invite">
                <button
                  type="button"
                  className="af-pf-invite-toggle"
                  aria-expanded={openInvite === l.leagueId}
                  onClick={() => setOpenInvite(openInvite === l.leagueId ? null : l.leagueId)}
                >
                  {openInvite === l.leagueId ? 'Hide invite link' : 'Invite managers'}
                </button>
                {openInvite === l.leagueId ? (
                  <LeagueInvitePanel leagueId={l.leagueId} compact />
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
          </ul>
        </section>
      ))}

      {/*
        The footer summary every board in this batch carries. On this screen it
        says what the list is scoped to, and is the way to add what is not here.
      */}
      <div className="af-bd-foot">
        <p className="af-bd-foot-text">
          {filtered
            ? `Showing ${leagues.length} of ${total} claimed teams — the filters above apply here too.`
            : `A league with no team claimed to you does not appear here — connect or re-import it and it will.`}
        </p>
        <Link className="af-bd-foot-cta" href={importHref}>
          Import a league &rarr;
        </Link>
      </div>
    </>
  )
}

export default Portfolio
