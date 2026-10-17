'use client'

import { devyTrendPresentation, type DevyTrend } from '@/lib/devy/devyTrend'

/**
 * The trend mark both devy screens draw — the hub (`DevyCore`) and the per-league tab
 * (`DevyLeagueTab`). One component so an unmeasured trend reads the same on both: a neutral dot
 * titled "No trend measured", never an arrow. See `lib/devy/devyTrend.ts` for why there is no
 * measured trend today.
 */
export default function DevyTrendMark({ trend }: { trend: DevyTrend | null }) {
  const { glyph, label } = devyTrendPresentation(trend)
  return (
    <span className={trend == null ? 'af-devy-trend' : `af-devy-trend af-devy-trend--${trend}`} title={label}>
      <span aria-hidden="true">{glyph}</span>
      <span className="af-sr-only"> {label}</span>
    </span>
  )
}
