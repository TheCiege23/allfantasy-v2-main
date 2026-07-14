'use client'

import Link from 'next/link'
import type { MatchupCenterPayload } from '@/lib/matchup-center/types'

export function MatchupInsightsPanel({
  insights,
  partialData,
  leagueId,
  onStartSit,
}: {
  insights: MatchupCenterPayload['insights']
  partialData: boolean
  leagueId: string
  onStartSit?: () => void
}) {
  return (
    <div className="space-y-2 rounded-2xl border border-subtle bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted">AI & insights</h3>
        {partialData ? (
          <span className="text-[10px] text-amber-200/80">Partial data - refreshing sources…</span>
        ) : null}
      </div>
      <div className="space-y-2 text-[12px] leading-snug text-secondary">
        <p>
          <span className="font-semibold text-cyan-200/90">Edge: </span>
          {insights.matchupEdge}
        </p>
        <p>
          <span className="font-semibold text-cyan-200/90">Start/sit: </span>
          {insights.startSit}
        </p>
        <p>
          <span className="font-semibold text-cyan-200/90">Floor vs ceiling: </span>
          {insights.floorVsCeiling}
        </p>
        <p>
          <span className="font-semibold text-cyan-200/90">Risk: </span>
          <span className="uppercase tracking-wide text-secondary">{insights.riskLevel}</span>
          <span className="text-muted"> - volatility heuristic from projections vs actuals.</span>
        </p>
        <p>
          <span className="font-semibold text-cyan-200/90">Swing players: </span>
        </p>
        <ul className="list-disc space-y-1 pl-4 text-[11px] text-secondary">
          {insights.swingPlayers.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
        <p>
          <span className="font-semibold text-cyan-200/90">Weather: </span>
          {insights.weather}
        </p>
        <p>
          <span className="font-semibold text-cyan-200/90">Injuries & news: </span>
          {insights.injuryNews}
        </p>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 border-t border-subtle pt-3">
        <Link
          href={`/league/${leagueId}?tab=waivers`}
          className="rounded-lg border border-cyan-400/25 bg-cyan-500/10 px-3 py-1.5 text-[11px] font-medium text-cyan-200 hover:bg-cyan-500/20"
        >
          Check Waiver Wire
        </Link>
        <Link
          href={`/ai-chat?leagueId=${leagueId}`}
          className="rounded-lg border border-violet-400/25 bg-violet-500/10 px-3 py-1.5 text-[11px] font-medium text-violet-200 hover:bg-violet-500/20"
        >
          Ask Chimmy
        </Link>
        {onStartSit ? (
          <button
            type="button"
            onClick={onStartSit}
            className="rounded-lg border border-amber-400/25 bg-amber-500/10 px-3 py-1.5 text-[11px] font-medium text-amber-200 hover:bg-amber-500/20"
          >
            Review Start/Sit
          </button>
        ) : null}
      </div>
    </div>
  )
}
