'use client'

import { useEffect, useState } from 'react'
import { TrendingUp, TrendingDown, Minus, AlertTriangle } from 'lucide-react'
import type { PlayerIdentity } from '../PlayerProfileClient'
import { getTeamLogoUrl } from '@/lib/player-media-urls'
import { FallbackImg } from '@/components/core-app/FallbackImg'

type OutlookSnippet = {
  currentValue?: number
  trend?: string
  trendStrength?: number
  riskLevel?: string
  injuryStatus?: string
  restOfSeasonTier?: number
}

function statusBadge(status: string) {
  const s = status.toLowerCase()
  if (s === 'active') return null
  const colors: Record<string, string> = {
    questionable: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
    doubtful: 'bg-orange-500/15 text-orange-300 border-orange-500/25',
    out: 'bg-red-500/15 text-red-300 border-red-500/25',
    ir: 'bg-red-500/15 text-red-300 border-red-500/25',
    injured: 'bg-red-500/15 text-red-300 border-red-500/25',
    suspended: 'bg-violet-500/15 text-violet-300 border-violet-500/25',
    pup: 'bg-orange-500/15 text-orange-300 border-orange-500/25',
  }
  const cls = colors[s] ?? 'bg-white/10 text-white/50 border-white/10'
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-bold uppercase ${cls}`}>
      <AlertTriangle className="h-2.5 w-2.5" /> {status}
    </span>
  )
}

function trendIcon(trend?: string) {
  if (trend === 'buy') return <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
  if (trend === 'sell') return <TrendingDown className="h-3.5 w-3.5 text-red-400" />
  return <Minus className="h-3.5 w-3.5 text-white/30" />
}

function trendColor(trend?: string) {
  if (trend === 'buy') return 'text-emerald-400'
  if (trend === 'sell') return 'text-red-400'
  return 'text-white/50'
}

export function PlayerHeaderCard({
  player,
  headshotUrl,
}: {
  player: PlayerIdentity
  headshotUrl: string | null
}) {
  const [outlook, setOutlook] = useState<OutlookSnippet | null>(null)

  useEffect(() => {
    fetch(`/api/player-outlook?playerName=${encodeURIComponent(player.name)}&sport=${encodeURIComponent(player.sport)}&narrative=false`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setOutlook({
            currentValue: d.currentValue ?? d.value,
            trend: d.trend,
            trendStrength: d.trendStrength,
            riskLevel: d.riskLevel,
            injuryStatus: d.injuryStatus,
            restOfSeasonTier: d.restOfSeasonTier,
          })
        }
      })
      .catch(() => {})
  }, [player.name, player.sport])

  const teamLogoUrl = getTeamLogoUrl(player.team, player.sport) ?? ''
  const injuryDisplay = outlook?.injuryStatus && outlook.injuryStatus !== 'Active' ? outlook.injuryStatus : player.status !== 'active' ? player.status : null

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-br from-[#0c1025] to-[#0a0e1a]">
      {/* Background team logo */}
      <div className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 opacity-[0.04]">
        {teamLogoUrl ? <FallbackImg src={teamLogoUrl} alt="" className="h-full w-full object-contain" fallback={null} /> : null}
      </div>

      <div className="relative flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:gap-5">
        {/* Headshot */}
        <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl border-2 border-white/[0.08] bg-[#12192e]">
          {headshotUrl ? (
            /* The fallback is a React node: the old onError wrote innerHTML into a parent React owns. */
            <FallbackImg
              src={headshotUrl}
              alt={player.name}
              className="h-full w-full object-cover"
              fallback={
                <span className="text-2xl font-black text-white/20">
                  {player.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}
                </span>
              }
            />
          ) : (
            <span className="text-2xl font-black text-white/20">
              {player.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}
            </span>
          )}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-black text-white sm:text-2xl">{player.name}</h2>
            {injuryDisplay && statusBadge(injuryDisplay)}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px]">
            <span className="font-semibold text-cyan-300">{player.position}</span>
            <span className="text-white/30">·</span>
            <span className="text-white/60">{player.team}</span>
            <span className="text-white/30">·</span>
            <span className="text-white/40">{player.sport}</span>
          </div>

          {/* Quick stats row */}
          <div className="mt-3 flex flex-wrap gap-2">
            {outlook?.currentValue != null && (
              <div className="rounded-lg bg-white/[0.04] px-2.5 py-1">
                <span className="text-[11px] uppercase text-white/30">Value</span>
                <p className="text-[14px] font-bold text-white">{outlook.currentValue}</p>
              </div>
            )}
            {outlook?.trend && (
              <div className="flex items-center gap-1 rounded-lg bg-white/[0.04] px-2.5 py-1">
                <span className="text-[11px] uppercase text-white/30">Trend</span>
                <div className={`flex items-center gap-0.5 text-[13px] font-bold ${trendColor(outlook.trend)}`}>
                  {trendIcon(outlook.trend)}
                  <span className="uppercase">{outlook.trend}</span>
                </div>
              </div>
            )}
            {outlook?.restOfSeasonTier != null && (
              <div className="rounded-lg bg-white/[0.04] px-2.5 py-1">
                <span className="text-[11px] uppercase text-white/30">ROS Tier</span>
                <p className="text-[14px] font-bold text-white">{outlook.restOfSeasonTier}</p>
              </div>
            )}
            {outlook?.riskLevel && (
              <div className="rounded-lg bg-white/[0.04] px-2.5 py-1">
                <span className="text-[11px] uppercase text-white/30">Risk</span>
                <p className={`text-[13px] font-bold ${
                  outlook.riskLevel === 'low' ? 'text-emerald-400' :
                  outlook.riskLevel === 'moderate' ? 'text-amber-300' :
                  outlook.riskLevel === 'high' ? 'text-orange-400' :
                  'text-red-400'
                }`}>
                  {outlook.riskLevel}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
