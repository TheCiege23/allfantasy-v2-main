'use client'

import { useEffect, useState } from 'react'
import type { PlayerIdentity } from '../PlayerProfileClient'
import { ProjectionCard } from '@/components/sports/ProjectionCard'
import { usePlayerProjection } from '@/hooks/useProjections'

type OutlookData = {
  outlookSummary?: string
  recentTrendSummary?: string
  currentValue?: number
  currentRank?: number
  positionRank?: number
  trend?: string
  trendStrength?: number
  riskLevel?: string
  opportunityScore?: number
  roleSecurityScore?: number
  bestFormatFit?: string
  tags?: string[]
}

export function OverviewTab({ player }: { player: PlayerIdentity }) {
  const [data, setData] = useState<OutlookData | null>(null)
  const [loading, setLoading] = useState(true)
  const { data: projData } = usePlayerProjection(player.name, player.sport)

  useEffect(() => {
    fetch(`/api/player-outlook?playerName=${encodeURIComponent(player.name)}&sport=${encodeURIComponent(player.sport)}&narrative=true`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [player.name, player.sport])

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-white/[0.04]" />)}
      </div>
    )
  }

  if (!data) {
    return <p className="py-8 text-center text-sm text-white/40">No overview data available for {player.name}.</p>
  }

  return (
    <div className="space-y-4">
      {data.outlookSummary && (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-white/30">Outlook Summary</p>
          <p className="text-[13px] leading-relaxed text-white/70">{data.outlookSummary}</p>
        </div>
      )}

      {data.recentTrendSummary && (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-white/30">Recent Trend</p>
          <p className="text-[13px] leading-relaxed text-white/70">{data.recentTrendSummary}</p>
        </div>
      )}

      {projData && <ProjectionCard data={projData} />}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatBox label="Overall Rank" value={data.currentRank != null ? `#${data.currentRank}` : '—'} />
        <StatBox label="Position Rank" value={data.positionRank != null ? `#${data.positionRank}` : '—'} />
        <StatBox label="Opportunity" value={data.opportunityScore != null ? `${data.opportunityScore}/100` : '—'} />
        <StatBox label="Role Security" value={data.roleSecurityScore != null ? `${data.roleSecurityScore}/100` : '—'} />
      </div>

      {data.tags && data.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {data.tags.map((t) => (
            <span key={t} className="rounded-md bg-cyan-500/10 px-2 py-0.5 text-[11px] font-semibold text-cyan-300">{t}</span>
          ))}
        </div>
      )}

      {data.bestFormatFit && (
        <p className="text-[11px] text-white/30">Best format fit: <span className="text-white/50">{data.bestFormatFit}</span></p>
      )}
    </div>
  )
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-center">
      <p className="text-[11px] uppercase tracking-wide text-white/30">{label}</p>
      <p className="mt-0.5 text-[16px] font-bold text-white/80">{value}</p>
    </div>
  )
}
