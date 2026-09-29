'use client'

import { useEffect, useState } from 'react'
import { BarChart3 } from 'lucide-react'
import type { PlayerIdentity } from '../PlayerProfileClient'

type AnalyticsData = {
  playerName?: string
  position?: string
  team?: string
  aiInsights?: string
  metaTrends?: {
    trendScore?: number
    addRate?: number
    dropRate?: number
    direction?: string
  }
  matchupPrediction?: {
    expectedPoints?: number
    expectedPointsPerGame?: number
    outlook?: string
    opponentTier?: string
  }
  careerProjection?: {
    breakoutProbability?: number
    declineProbability?: number
    volatilityScore?: number
  }
}

export function AnalyticsTab({ player }: { player: PlayerIdentity }) {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/player-card-analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName: player.name, position: player.position, team: player.team, sport: player.sport }),
      cache: 'no-store',
    } as any)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [player.name, player.position, player.team, player.sport])

  if (loading) {
    return <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-white/[0.04]" />)}</div>
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center py-12 text-center">
        <BarChart3 className="h-8 w-8 text-white/10" />
        <p className="mt-3 text-sm text-white/40">No analytics data available for {player.name}.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {data.aiInsights && (
        <div className="rounded-xl border border-purple-500/15 bg-purple-500/5 p-4">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-purple-300/50">AI Insights</p>
          <p className="text-[13px] leading-relaxed text-white/70">{data.aiInsights}</p>
        </div>
      )}

      {data.matchupPrediction && (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-white/30">Matchup Prediction</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MiniStat label="Exp. Pts" value={data.matchupPrediction.expectedPoints?.toFixed(1) ?? '—'} />
            <MiniStat label="Pts/Game" value={data.matchupPrediction.expectedPointsPerGame?.toFixed(1) ?? '—'} />
            <MiniStat label="Outlook" value={data.matchupPrediction.outlook ?? '—'} />
            <MiniStat label="Opp Tier" value={data.matchupPrediction.opponentTier ?? '—'} />
          </div>
        </div>
      )}

      {data.metaTrends && (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-white/30">Meta Trends</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MiniStat label="Trend Score" value={data.metaTrends.trendScore?.toFixed(0) ?? '—'} />
            <MiniStat label="Add Rate" value={data.metaTrends.addRate != null ? `${(data.metaTrends.addRate * 100).toFixed(1)}%` : '—'} />
            <MiniStat label="Drop Rate" value={data.metaTrends.dropRate != null ? `${(data.metaTrends.dropRate * 100).toFixed(1)}%` : '—'} />
            <MiniStat label="Direction" value={data.metaTrends.direction ?? '—'} />
          </div>
        </div>
      )}

      {data.careerProjection && (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-white/30">Career Projection</p>
          <div className="grid grid-cols-3 gap-3">
            <BarStat label="Breakout" pct={data.careerProjection.breakoutProbability ?? 0} color="emerald" />
            <BarStat label="Decline" pct={data.careerProjection.declineProbability ?? 0} color="red" />
            <BarStat label="Volatility" pct={data.careerProjection.volatilityScore ?? 0} color="amber" />
          </div>
        </div>
      )}
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase text-white/30">{label}</p>
      <p className="text-[14px] font-bold text-white/80">{value}</p>
    </div>
  )
}

function BarStat({ label, pct, color }: { label: string; pct: number; color: string }) {
  const bg = color === 'emerald' ? 'bg-emerald-500' : color === 'red' ? 'bg-red-500' : 'bg-amber-500'
  return (
    <div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="uppercase text-white/30">{label}</span>
        <span className="font-bold text-white/50">{Math.round(pct * 100)}%</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        <div className={`h-full rounded-full ${bg}`} style={{ width: `${Math.min(100, pct * 100)}%` }} />
      </div>
    </div>
  )
}
