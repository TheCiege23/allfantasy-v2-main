'use client'

import Link from 'next/link'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

type Player = {
  name: string
  position: string
  team: string
  sleeperId?: string
  value: number
  trend30Day: number
  overallRank: number
  tier: string
}

function trendDisplay(delta: number) {
  if (delta > 0) {
    return {
      icon: <TrendingUp className="h-3 w-3" />,
      color: 'text-emerald-400',
      prefix: '+',
    }
  }
  if (delta < 0) {
    return {
      icon: <TrendingDown className="h-3 w-3" />,
      color: 'text-red-400',
      prefix: '',
    }
  }
  return {
    icon: <Minus className="h-3 w-3" />,
    color: 'text-white/30',
    prefix: '',
  }
}

function tierColor(tier: string) {
  switch (tier) {
    case 'S': return 'bg-amber-500/15 text-amber-300 border-amber-500/25'
    case 'A': return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25'
    case 'B': return 'bg-cyan-500/15 text-cyan-300 border-cyan-500/25'
    case 'C': return 'bg-white/[0.06] text-white/50 border-white/10'
    default: return 'bg-white/[0.04] text-white/30 border-white/[0.06]'
  }
}

export function MarketMoverRow({ player, rank }: { player: Player; rank: number }) {
  const trend = trendDisplay(player.trend30Day)
  const headshotUrl = player.sleeperId
    ? `https://sleepercdn.com/content/nfl/players/thumb/${player.sleeperId}.jpg`
    : null

  const playerId = player.sleeperId ?? player.name.toLowerCase().replace(/\s+/g, '-')

  return (
    <Link
      href={`/player/${encodeURIComponent(playerId)}`}
      className="flex items-center gap-3 rounded-xl border border-white/[0.04] bg-white/[0.02] px-3 py-2.5 transition hover:border-white/[0.1] hover:bg-white/[0.04]"
    >
      {/* Rank */}
      <span className="w-8 text-center text-[12px] font-bold text-white/25">{rank}</span>

      {/* Avatar */}
      <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#12192e]">
        {headshotUrl ? (
          <img
            src={headshotUrl}
            alt=""
            className="h-full w-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
              e.currentTarget.parentElement!.innerHTML = `<span class="text-[11px] font-bold text-white/15">${player.name.split(' ').map(w => w[0]).join('').slice(0, 2)}</span>`
            }}
          />
        ) : (
          <span className="text-[11px] font-bold text-white/15">
            {player.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}
          </span>
        )}
      </div>

      {/* Name + meta */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-white/85">{player.name}</p>
        <p className="text-[11px] text-white/35">
          <span className="font-semibold text-cyan-300/60">{player.position}</span>
          {' · '}
          {player.team}
        </p>
      </div>

      {/* Value */}
      <div className="w-16 text-right">
        <p className="text-[13px] font-bold text-white/75">{player.value.toLocaleString()}</p>
      </div>

      {/* Change */}
      <div className={`flex w-16 items-center justify-end gap-1 text-[12px] font-bold ${trend.color}`}>
        {trend.icon}
        <span>{trend.prefix}{player.trend30Day.toLocaleString()}</span>
      </div>

      {/* Tier */}
      <span className={`w-10 rounded-md border px-1.5 py-0.5 text-center text-[11px] font-bold ${tierColor(player.tier)}`}>
        {player.tier}
      </span>
    </Link>
  )
}
