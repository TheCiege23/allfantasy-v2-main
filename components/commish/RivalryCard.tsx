'use client'

/**
 * 11d — one ranked rivalry.
 *
 * ⚠ THE SCORE AND ITS CHIPS ARE ONE OBJECT. Build rule 1: a rivalry score never
 * ships bare, for the same reason 11b's health score never does — it is a
 * computed number, and the chips beside it are what make it checkable. A card
 * whose chips did not resolve renders an honest note instead of a lone `91`,
 * which is why `chips.length === 0` is handled rather than assumed away.
 */

import type { RivalryBoardRow } from '@/lib/rivalry-engine/rivalryBoard'

export function RivalryCard({ row, featured = false }: { row: RivalryBoardRow; featured?: boolean }) {
  return (
    <article className="af-cm-rivalry" data-featured={featured ? 'true' : 'false'} data-testid={`rivalry-${row.id}`}>
      <div className="af-cm-rivalry-top">
        <h3 className="af-cm-rivalry-title">
          {row.teamAName} <span className="af-cm-vs">vs</span> {row.teamBName}
        </h3>
        <div className="af-cm-rivalry-score">
          {featured ? <div className="af-label">Rivalry score</div> : null}
          <div className="af-cm-rivalry-score-num af-num">{row.rivalryScore}</div>
        </div>
      </div>

      {row.chips.length > 0 ? (
        <div className="af-cm-rivalry-chips">
          {row.chips.map((chip, i) => (
            <span key={i} className="af-cm-rchip af-num" data-tone={chip.tone === 'warn' ? 'warn' : undefined}>
              {chip.label}
            </span>
          ))}
        </div>
      ) : (
        <p className="af-cm-rivalry-note">
          Scored, but the supporting history has not been rebuilt yet — re-run the rivalry engine to populate the
          breakdown.
        </p>
      )}

      {row.context ? <p className="af-cm-rivalry-note">{row.context}</p> : null}
    </article>
  )
}

export default RivalryCard
