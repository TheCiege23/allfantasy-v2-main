'use client'

import React from 'react'
import type { NflDraftProjectionSplits } from '@/lib/draft/analytics/nfl-draft-pool-projection-splits'
import { formatNflStatCell } from '@/lib/draft/analytics/nfl-draft-pool-projection-splits'

/** Shared 13-column grid: PROJ×2, RUSH×3, REC×3, PASS×5 */
export const NFL_DRAFT_POOL_STATS_GRID =
  'grid w-full min-w-[min(720px,100%)] grid-cols-[repeat(13,minmax(1.75rem,1fr))] gap-x-1'

function Cell({ children }: { children: React.ReactNode }) {
  return <div className="text-center tabular-nums text-white/88">{children}</div>
}

/** Slice D.1.5: a splits object can exist with every cell == 0 when the stats provider
 * (Rolling Insights) didn't return data for the player. In that case, show aligned em-dash
 * placeholders so the row visually matches the column header instead of looking like a
 * row of zeroes (which incorrectly implies "0 yards" rather than "no data"). */
function isAllZeroSplits(s: NflDraftProjectionSplits): boolean {
  const cells: Array<number | null | undefined> = [
    s.projectedPoints,
    s.projectedPointsPerGame,
    s.rushing?.att,
    s.rushing?.yds,
    s.rushing?.td,
    s.receiving?.rec,
    s.receiving?.yds,
    s.receiving?.td,
    s.passing?.cmp,
    s.passing?.att,
    s.passing?.yds,
    s.passing?.td,
    s.passing?.int,
  ]
  return cells.every((c) => c == null || c === 0)
}

export function NflDraftPoolStatsGroupHeader() {
  return (
    <div className="select-none">
      <div
        className={`${NFL_DRAFT_POOL_STATS_GRID} items-end border-b border-white/10 pb-1 text-[11px] font-semibold uppercase tracking-wide text-cyan-100/55`}
      >
        <div className="col-span-2 text-center">Proj</div>
        <div className="col-span-3 text-center">Rushing</div>
        <div className="col-span-3 text-center">Receiving</div>
        <div className="col-span-5 text-center">Passing</div>
      </div>
      <div
        className={`${NFL_DRAFT_POOL_STATS_GRID} mt-1 text-[11px] font-medium text-white/40`}
        aria-hidden
      >
        <span>PTS</span>
        <span>PPG</span>
        <span>Att</span>
        <span>Yds</span>
        <span>TD</span>
        <span>Rec</span>
        <span>Yds</span>
        <span>TD</span>
        <span>Cmp</span>
        <span>Att</span>
        <span>Yds</span>
        <span>TD</span>
        <span>Int</span>
      </div>
    </div>
  )
}

export function NflDraftPoolStatsRow({ splits }: { splits: NflDraftProjectionSplits }) {
  const s = splits
  if (isAllZeroSplits(s)) {
    return (
      <div
        className={`${NFL_DRAFT_POOL_STATS_GRID} py-1 text-[11px] leading-none`}
        title="Stats unavailable for this player"
        data-testid="nfl-draft-pool-stats-row-empty"
      >
        {Array.from({ length: 13 }).map((_, i) => (
          <div key={i} className="text-center tabular-nums font-medium text-white/65">—</div>
        ))}
      </div>
    )
  }
  return (
    <div className={`${NFL_DRAFT_POOL_STATS_GRID} text-[11px]`} data-testid="nfl-draft-pool-stats-row">
      <Cell>{formatNflStatCell(s.projectedPoints, 1)}</Cell>
      <Cell>{formatNflStatCell(s.projectedPointsPerGame, 1)}</Cell>
      <Cell>{formatNflStatCell(s.rushing.att)}</Cell>
      <Cell>{formatNflStatCell(s.rushing.yds)}</Cell>
      <Cell>{formatNflStatCell(s.rushing.td)}</Cell>
      <Cell>{formatNflStatCell(s.receiving.rec)}</Cell>
      <Cell>{formatNflStatCell(s.receiving.yds)}</Cell>
      <Cell>{formatNflStatCell(s.receiving.td)}</Cell>
      <Cell>{formatNflStatCell(s.passing.cmp)}</Cell>
      <Cell>{formatNflStatCell(s.passing.att)}</Cell>
      <Cell>{formatNflStatCell(s.passing.yds)}</Cell>
      <Cell>{formatNflStatCell(s.passing.td)}</Cell>
      <Cell>{formatNflStatCell(s.passing.int)}</Cell>
    </div>
  )
}
