import type { LeagueImpact } from '@/lib/core-app/playerImpact'

/**
 * "Swap candidates on your bench" — the handoff's right-column panel.
 *
 * ⚠ THESE ARE ALTERNATIVES TO HIM, NOT REASONS TO START HIM, AND THE DIRECTION
 * MATTERS. `ReplacementOption.delta` is the candidate's points MINUS this
 * player's, both under the same league's scoring. So a POSITIVE delta means the
 * bench player is worth more — which is why the handoff colours that green: it
 * is the one row that changes what you do. Reading the sign the other way would
 * recommend the worse player.
 *
 * ⚠ EVERY NUMBER IS PER LEAGUE. The same bench player is a different asset in a
 * 1.5 TE-premium league than in Standard, so each row carries the league it was
 * priced in. A single merged list without the league would be a global ranking,
 * which this screen exists specifically not to show.
 *
 * ⚠ A CANDIDATE WE COULD NOT PRICE IS STILL LISTED, WITHOUT A NUMBER.
 * `afPoints` and `delta` are nullable because the scoring settings do not always
 * cover every stat key. Dropping those rows would quietly narrow the bench;
 * printing 0.0 would claim he is worthless. Both are worse than an em dash.
 */

type Row = {
  key: string
  name: string
  leagueName: string
  from: string
  points: number | null
  delta: number | null
  injuryStatus: string | null
}

export function SwapCandidates({ impact }: { impact: LeagueImpact[] }) {
  const rows: Row[] = []
  for (const league of impact) {
    if (!league.replacements.available) continue
    for (const option of league.replacements.data) {
      rows.push({
        key: `${league.leagueId}:${option.playerId}`,
        name: option.name,
        leagueName: league.leagueName,
        from: option.from,
        points: option.afPoints,
        delta: option.delta,
        injuryStatus: option.injuryStatus,
      })
    }
  }

  if (rows.length === 0) return null

  /*
   * Best upgrade first. Rows we could not price sort last rather than being
   * treated as zero — an unknown is not a bad option, it is an unknown.
   */
  rows.sort((a, b) => {
    if (a.delta == null && b.delta == null) return 0
    if (a.delta == null) return 1
    if (b.delta == null) return -1
    return b.delta - a.delta
  })

  return (
    <section className="af-card af-pf-swaps" aria-label="Swap candidates on your bench">
      <h3 className="af-label af-pf-swaps-title">Swap candidates on your bench</h3>
      <ul className="af-pf-swap-list">
        {rows.slice(0, 8).map((row) => (
          <li key={row.key} className="af-pf-swap-row">
            <span className="af-pf-swap-text">
              <span className="af-pf-swap-name">{row.name}</span>
              <span className="af-pf-swap-meta af-num">
                {[row.leagueName, row.from, row.injuryStatus].filter(Boolean).join(' · ')}
              </span>
            </span>
            <span
              className="af-pf-swap-pts af-num"
              /* Green only when he genuinely beats the player you searched, under
                 that league's own scoring. */
              data-better={row.delta != null && row.delta > 0 ? 'true' : undefined}
            >
              {row.points != null ? row.points.toFixed(1) : '—'}
            </span>
          </li>
        ))}
      </ul>
      <p className="af-pf-swaps-foot">
        Points are under each league&apos;s own scoring, so the same player can be
        worth more in one than another. Green beats the player you searched.
      </p>
    </section>
  )
}

export default SwapCandidates
