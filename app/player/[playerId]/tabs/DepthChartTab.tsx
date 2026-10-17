'use client'

import { DepthChartPanel } from '@/components/sports/DepthChartPanel'
import type { PlayerIdentity } from '../PlayerProfileClient'

export function DepthChartTab({ player }: { player: PlayerIdentity }) {
  return (
    <div className="space-y-4">
      <DepthChartPanel sport={player.sport} team={player.team} />
      <p className="text-[11px] text-white/25">
        Depth chart data is refreshed weekly from Rolling Insights and updated with injury reports.
      </p>
    </div>
  )
}
