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

  return (
    <div className="af-d2-card">
      <ul className="af-d2-portfolio">
        {rows.map((row) => (
          <li key={row.leagueId} className="af-d2-portfolio-row">
            <span className="af-d2-portfolio-name">{row.leagueName}</span>
            <span className="af-d2-portfolio-meta af-num">
              {[row.platform, row.sport, row.season].filter(Boolean).join(' · ')}
            </span>
            <span className="af-d2-portfolio-right af-num">
              {row.isCommissioner ? <span className="af-d2-portfolio-commish">COMMISH</span> : null}
              {row.rosterCount != null ? `${row.rosterCount} players` : 'no roster imported'}
              {/* record intentionally omitted — see the note at the top. */}
            </span>
          </li>
        ))}
      </ul>

      <p className="af-d2-portfolio-foot">
        {rows.length} {rows.length === 1 ? 'league' : 'leagues'}, {withRoster} with a
        roster imported. Market value per roster is not shown — that needs
        per-player values summed per league, which is not wired yet.
        {data.commissionedCount > 0
          ? ` You commission ${data.commissionedCount} of them.`
          : ''}
      </p>

      <Link href="/core/portfolio" className="af-d2-legacy-link">
        Open Portfolio
      </Link>
    </div>
  )
}

export default PortfolioInventory
