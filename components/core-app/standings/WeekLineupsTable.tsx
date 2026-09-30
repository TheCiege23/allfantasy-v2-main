import type { StandingsLineups } from '@/lib/core-app/standingsLineups'
import '@/components/core-app/af-standings.css'

/**
 * This week's lineups, projected — every team, AllFantasy's engine (AF) beside the provider's (API).
 * Shared by the Standings screen and the league Season Outlook.
 *
 * ⚠ A PROJECTION OF THE COMING WEEK, NOT A STANDING. The caller's `caveat` says what this is NOT
 * (the points table, the simulated odds). A total built from part of a lineup shows its coverage
 * rather than passing for a whole one, and an unpriced side is a dash, never 0.
 *
 * `import type` only from the server module: this file is client-safe.
 */
export function WeekLineupsTable({ lineups, caveat }: { lineups: StandingsLineups; caveat: string }) {
  const cell = (v: number | null, from: number, of: number) =>
    v == null ? (
      <span className="af-st-lu-none">—</span>
    ) : (
      <>
        {v.toFixed(1)}
        {from < of ? <span className="af-st-lu-cov"> {from}/{of}</span> : null}
      </>
    )
  return (
    <section className="af-st-section af-st-lineups" aria-labelledby="af-st-lu-h">
      <h2 className="af-label af-st-seclabel" id="af-st-lu-h">
        This week’s lineups, projected · week {lineups.week}
      </h2>
      <p className="af-st-lu-note">
        Each team’s lineup as currently set, projected for week {lineups.week} under this league’s scoring. AF is
        AllFantasy’s own projection engine; API is the provider’s (Sleeper). A forecast of the coming week — {caveat}
      </p>
      <table className="af-st-lu-table">
        <thead>
          <tr>
            <th scope="col">Team</th>
            <th scope="col" className="af-num">AF</th>
            <th scope="col" className="af-num">API</th>
          </tr>
        </thead>
        <tbody>
          {lineups.rows.map((r) => (
            <tr key={r.rosterId} data-you={r.isYou ? 'true' : undefined}>
              <th scope="row">
                {r.name ?? `Team ${r.rosterId}`}
                {r.isYou ? <span className="af-st-lu-you"> · you</span> : null}
              </th>
              <td className="af-num af-st-lu-af">{cell(r.af, r.afFrom, r.starterCount)}</td>
              <td className="af-num">{cell(r.api, r.apiFrom, r.starterCount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
