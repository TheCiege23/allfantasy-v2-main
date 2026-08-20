'use client'

import { useState } from 'react'
import Link from 'next/link'
import { LeagueInvitePanel } from '@/components/core-app/LeagueInvitePanel'
import type { PortfolioData } from '@/lib/core-app/portfolio'
import '@/components/core-app/af-portfolio.css'

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
 * detail modal; a link is addressable, shareable and survives a refresh, and the
 * league page already exists at /league/{id}.
 */

export type PortfolioProps = {
  data: PortfolioData
  /** Where "import a league" should go — carries the return path. */
  importHref?: string
}

export function Portfolio({ data, importHref = '/import?returnTo=%2Fcore%2Fportfolio' }: PortfolioProps) {
  /*
   * ⚠ ONE OPEN AT A TIME, AND FETCHED ONLY WHEN OPENED. One production account
   * commissions 40 leagues. Rendering an invite panel per row would fire forty
   * simultaneous requests to /api/leagues/join on page load, for links nobody
   * asked to see. The panel fetches on mount, so not mounting it IS the guard.
   */
  const [openInvite, setOpenInvite] = useState<string | null>(null)
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
          <p className="af-pf-sub">
            {leagues.length} {leagues.length === 1 ? 'league' : 'leagues'}
            {data.commissionedCount > 0 ? ` · you commission ${data.commissionedCount}` : ''}
          </p>
        </div>
        <Link href={importHref} className="af-pf-btn">
          Import a league
        </Link>
      </header>

      <ul className="af-pf-list">
        {leagues.map((l) => (
          <li key={l.leagueId} className="af-pf-item">
            <Link href={`/league/${l.leagueId}`} className="af-pf-row">
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
                  <span className="af-pf-platform" data-platform={l.platform}>
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
                            l.team.rank != null
                              ? ` · #${l.team.rank}${l.team.teamCount ? ` of ${l.team.teamCount}` : ''}`
                              : ''
                          }`
                        : l.team.teamCount
                          ? `${l.team.teamCount}-team league · season not started`
                          : 'season not started'}
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
              */}
              <span className="af-pf-row-roster">
                {l.rosterCount == null ? (
                  <span className="af-pf-roster-none">no roster imported</span>
                ) : l.rosterCount === 0 ? (
                  <span className="af-pf-roster-none">no roster data</span>
                ) : (
                  <span className="af-num">{l.rosterCount} players</span>
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
    </div>
  )
}

export default Portfolio
