'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { TrendingUp, TrendingDown, ArrowRight } from 'lucide-react'
import type { PlayerIdentity } from '../PlayerProfileClient'

type TrendData = {
  value?: number
  valueDelta?: number
  trend30Day?: number
  tier?: string
  rank?: number
  positionRank?: number
  direction?: string
}

export function MarketTab({ player }: { player: PlayerIdentity }) {
  const [data, setData] = useState<TrendData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/player-trend?playerId=${encodeURIComponent(player.id)}&sport=${encodeURIComponent(player.sport)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setData(d)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [player.id, player.sport])

  if (loading) {
    return <div className="space-y-3">{[1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-white/[0.04]" />)}</div>
  }

  return (
    <div className="space-y-4">
      {data ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <ValueBox label="Current Value" value={data.value != null ? String(data.value) : '—'} />
            <ValueBox
              label="30-Day Change"
              value={data.trend30Day != null ? `${data.trend30Day > 0 ? '+' : ''}${data.trend30Day}` : '—'}
              tone={data.trend30Day != null ? (data.trend30Day > 0 ? 'positive' : data.trend30Day < 0 ? 'negative' : 'neutral') : 'neutral'}
            />
            <ValueBox label="Tier" value={data.tier ?? '—'} />
            <ValueBox label="Rank" value={data.rank != null ? `#${data.rank}` : '—'} />
          </div>

          {data.direction && (
            <div className={`flex items-center gap-2 rounded-xl p-3 text-[12px] font-medium ${
              data.direction === 'up' ? 'border border-emerald-500/15 bg-emerald-500/5 text-emerald-300' :
              data.direction === 'down' ? 'border border-red-500/15 bg-red-500/5 text-red-300' :
              'border border-white/[0.08] bg-white/[0.03] text-white/50'
            }`}>
              {data.direction === 'up' ? <TrendingUp className="h-4 w-4" /> : data.direction === 'down' ? <TrendingDown className="h-4 w-4" /> : null}
              Market trend: {data.direction === 'up' ? 'Rising' : data.direction === 'down' ? 'Falling' : 'Stable'}
            </div>
          )}
        </>
      ) : (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-6 text-center">
          <p className="text-sm text-white/40">No market data available for {player.name}.</p>
          <p className="mt-1 text-xs text-white/25">Canonical market values are currently unavailable.</p>
        </div>
      )}

      <Link
        href="/market-movers"
        className="flex items-center gap-1.5 text-[12px] font-semibold text-cyan-300 transition hover:text-cyan-200"
      >
        View Market Movers <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  )
}

function ValueBox({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'positive' | 'negative' | 'neutral' }) {
  const color = tone === 'positive' ? 'text-emerald-400' : tone === 'negative' ? 'text-red-400' : 'text-white/80'
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-center">
      <p className="text-[9px] uppercase tracking-wide text-white/30">{label}</p>
      <p className={`mt-0.5 text-[16px] font-bold ${color}`}>{value}</p>
    </div>
  )
}
