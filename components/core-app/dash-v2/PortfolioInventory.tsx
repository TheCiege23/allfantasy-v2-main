import Link from 'next/link'
import type { PortfolioData } from '@/lib/core-app/portfolio'

/**
 * Portfolio — the league inventory, wired to getPortfolio.
 *
 * ⚠ THIS IS NOT THE MOCKUP'S "ROSTER MARKET VALUE" MODULE, AND THE DIFFERENCE IS
 * REAL. The handoff draws ranked bars with a market value per league (IDP Dynasty
 * 50,657 → AFC Dreaming 28,844) and a 400,595 total. `getPortfolio` does not
 * return values: it returns the inventory — league, your team, record, roster
 * size, whether you commission it. Summing per-player market values per roster is
 * separate work against the player-value tables, not a rendering choice.
 *
 * What ships here is the half that is real. The bars are not drawn with invented
 * numbers, and the section says what it is showing.
 *
 * ⚠ `record` IS NULL FOR EVERY TEAM ON THIS DATABASE — 0 of 893 LeagueTeam rows
 * carry a result — so the column is omitted rather than printing 0-0, which reads
 * as a played-and-lost season rather than as no data. It appears on its own once
 * results are synced.
 */
export function PortfolioInventory({ data }: { data: PortfolioData | null }) {
  const state = data?.leagues

  /*
   * SectionState carries a `reason` when unavailable, and it exists to be shown.
   * Collapsing it into a generic empty state throws away the one thing that
   * tells a user whether this is "nothing imported" or "we could not read it".
   */
  if (!state) {
    return (
      <div className="af-d2-card">
        <p className="af-d2-empty">Portfolio could not be loaded.</p>
      </div>
    )
  }
  if (!state.available) {
    return (
      <div className="af-d2-card">
        <p className="af-d2-empty">{state.reason}</p>
      </div>
    )
  }

  const rows = state.data

  if (rows.length === 0) {
    return (
      <div className="af-d2-card">
        <p className="af-d2-empty">
          No leagues to inventory yet. Import one and every league you are in shows
          here with its roster and your role.
        </p>
      </div>
    )
  }

  const withRoster = rows.filter((r) => (r.rosterCount ?? 0) > 0).length

  /*
   * Collapsed by default. At 61 leagues this list is ~1,800px of rows that push
   * every section below it off the page — the inventory is reference material,
   * not something to scroll past on every visit. <details> rather than React
   * state so it works before hydration and stays keyboard-accessible for free.
   */
  return (
    <details className="af-d2-card af-d2-portfolio-wrap">
      <summary className="af-d2-portfolio-summary">
        <span className="af-d2-portfolio-summary-text">
          {rows.length} {rows.length === 1 ? 'league' : 'leagues'}
          {withRoster > 0 ? ` · ${withRoster} with a roster` : ''}
          {data.commissionedCount > 0 ? ` · you commission ${data.commissionedCount}` : ''}
        </span>
        <span className="af-d2-portfolio-summary-hint af-num">SHOW ALL</span>
      </summary>

      <ul className="af-d2-portfolio">
        {rows.map((row) => (
          <li key={row.leagueId} className="af-d2-portfolio-item">
            {/*
              Each league opens to its own roster detail rather than the list
              carrying every fact inline. At 61 leagues an always-expanded row is
              a wall; the summary answers "what is this league" and the body
              answers "what is in it".
            */}
            <details className="af-d2-portfolio-row">
              <summary className="af-d2-portfolio-summary-row">
                <span className="af-d2-portfolio-name">{row.leagueName}</span>
                <span className="af-d2-portfolio-meta af-num">
                  {[row.platform, row.sport, row.season].filter(Boolean).join(' · ')}
                </span>
                <span className="af-d2-portfolio-right af-num">
                  {row.isCommissioner ? (
                    <span className="af-d2-portfolio-commish">COMMISH</span>
                  ) : null}
                  {row.rosterCount != null ? `${row.rosterCount} players` : 'no roster'}
                </span>
              </summary>

              <div className="af-d2-portfolio-detail">
                <dl className="af-d2-portfolio-facts">
                  <div>
                    <dt className="af-num">TEAM</dt>
                    <dd>{row.team?.name ?? 'Not resolved'}</dd>
                  </div>
                  <div>
                    <dt className="af-num">ROSTER</dt>
                    <dd>
                      {row.rosterCount != null
                        ? `${row.rosterCount} players imported`
                        : 'No roster imported yet'}
                    </dd>
                  </div>
                  <div>
                    <dt className="af-num">RECORD</dt>
                    {/*
                      Null on every team on this database — 0 of 893 LeagueTeam
                      rows carry a result. Saying so beats printing 0-0, which
                      reads as a played-and-lost season rather than as no data.
                    */}
                    <dd>{row.team?.record ?? 'No results synced'}</dd>
                  </div>
                  <div>
                    <dt className="af-num">ROLE</dt>
                    <dd>{row.isCommissioner ? 'You commission this league' : 'Manager'}</dd>
                  </div>
                </dl>
              </div>
            </details>
          </li>
        ))}
      </ul>

      <p className="af-d2-portfolio-foot">
        Market value per roster is not shown — that needs per-player values summed
        per league, which is not wired yet.
      </p>

      <Link href="/core/portfolio" className="af-d2-legacy-link">
        Open Portfolio
      </Link>
    </details>
  )
}

export default PortfolioInventory
