'use client'

import { useEffect, useState } from 'react'
import { TrendingUp, TrendingDown, Shield } from 'lucide-react'
import type { PlayerIdentity } from '../PlayerProfileClient'

type OutlookData = {
  outlookSummary?: string
  bullishCase?: string
  bearishCase?: string
  restOfSeasonTier?: number
  weeklyTier?: number
  dynastyTier?: number
  trend?: string
  confidencePct?: number
  riskFlags?: string[]
  timeHorizon?: string
  bestFormatFit?: string
}

export function OutlookTab({ player }: { player: PlayerIdentity }) {
  const [data, setData] = useState<OutlookData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/player-outlook?playerName=${encodeURIComponent(player.name)}&sport=${encodeURIComponent(player.sport)}&narrative=true`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [player.name, player.sport])

  if (loading) {
    return <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-white/[0.04]" />)}</div>
  }

  if (!data) {
    return <p className="py-8 text-center text-sm text-white/40">No outlook data available.</p>
  }

  return (
    <div className="space-y-4">
      {data.outlookSummary && (
        <div className="rounded-xl border border-cyan-500/15 bg-cyan-500/5 p-4">
          <p className="text-[13px] leading-relaxed text-cyan-100/80">{data.outlookSummary}</p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <TierBox label="ROS Tier" tier={data.restOfSeasonTier} />
        <TierBox label="Weekly" tier={data.weeklyTier} />
        <TierBox label="Dynasty" tier={data.dynastyTier} />
      </div>

      {(data.bullishCase || data.bearishCase) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {data.bullishCase && (
            <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/5 p-4">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold text-emerald-400">
                <TrendingUp className="h-3.5 w-3.5" /> Bull Case
              </div>
              <p className="text-[12px] leading-relaxed text-white/60">{data.bullishCase}</p>
            </div>
          )}
          {data.bearishCase && (
            <div className="rounded-xl border border-red-500/15 bg-red-500/5 p-4">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold text-red-400">
                <TrendingDown className="h-3.5 w-3.5" /> Bear Case
              </div>
              <p className="text-[12px] leading-relaxed text-white/60">{data.bearishCase}</p>
            </div>
          )}
        </div>
      )}

      {data.riskFlags && data.riskFlags.length > 0 && (
        <div className="rounded-xl border border-amber-500/15 bg-amber-500/5 p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold text-amber-300">
            <Shield className="h-3.5 w-3.5" /> Risk Flags
          </div>
          <div className="flex flex-wrap gap-1">
            {data.riskFlags.map((f) => (
              <span key={f} className="rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-200">{f}</span>
            ))}
          </div>
        </div>
      )}

      {data.confidencePct != null && (
        <p className="text-[11px] text-white/25">
          AI confidence: {data.confidencePct}% · Format fit: {data.bestFormatFit ?? 'all'} · Horizon: {data.timeHorizon ?? '—'}
        </p>
      )}
    </div>
  )
}

function TierBox({ label, tier }: { label: string; tier?: number | null }) {
  const display = tier != null ? `T${tier}` : '—'
  const color = tier != null && tier <= 2 ? 'text-emerald-400' : tier != null && tier <= 4 ? 'text-cyan-300' : 'text-white/50'
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-center">
      <p className="text-[11px] uppercase tracking-wide text-white/30">{label}</p>
      <p className={`mt-0.5 text-[18px] font-black ${color}`}>{display}</p>
    </div>
  )
}
