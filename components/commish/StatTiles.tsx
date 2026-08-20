'use client'

/**
 * 11a — the five cross-league stat tiles.
 *
 * ⚠ A TILE TAKES A FULL OUTLINE WHERE A QUEUE ROW TAKES A LEFT EDGE. Not an
 * inconsistency: five tiles on a wall are single objects and an outline is what
 * makes one findable at a glance, whereas six stacked list rows with outlines
 * become a block of colour nobody can read. Both rules live in af-commish.css.
 *
 * ⚠ `null` IS A FIRST-CLASS VALUE. A count we could not compute renders as an em
 * dash with no tone. Every tile below can legitimately be unknown — a league
 * whose last sync failed contributes to none of these totals — and showing `0`
 * for "we don't know" is the specific failure 11a build rule 3 exists to stop.
 */

export type StatTile = {
  key: string
  label: string
  value: number | null
  /** The line under the number. Says what the denominator is, never decoration. */
  foot: string
  tone?: 'good' | 'warn' | 'bad'
  help?: string
}

export function StatTiles({ tiles, columns }: { tiles: StatTile[]; columns?: number }) {
  return (
    <div
      className="af-cm-tiles"
      data-testid="commish-stat-tiles"
      /*
       * The stylesheet's five-column default is 11a's wall of leagues/healthy/at
       * risk/inactive/retention. 11b's risk row is three tiles and would
       * otherwise render two-fifths wide with a gap beside it, so the count is a
       * prop rather than a second class. The responsive breakpoints in
       * af-commish.css still win below 1180px because they are media queries.
       */
      style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
    >
      {tiles.map((t) => (
        <div key={t.key} className="af-cm-tile" data-tone={t.value == null ? undefined : t.tone}>
          <div className="af-cm-tile-label">
            {t.label}
            {t.help ? (
              <button type="button" className="af-cm-help" title={t.help} aria-label={`About ${t.label}`}>
                ?
              </button>
            ) : null}
          </div>
          <div className="af-cm-tile-value af-num">{t.value != null ? t.value : '—'}</div>
          <div className="af-cm-tile-foot">{t.foot}</div>
        </div>
      ))}
    </div>
  )
}

export default StatTiles
