'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  buildEnrichedPlayer,
  resolveHeadshot,
  resolveHeadshotCandidates,
} from '@/lib/players/buildPlayerMap'

type PlayerImageProps = {
  sleeperId: string
  sport?: string
  name?: string
  position?: string
  /** Rolling Insights or other primary headshot */
  headshotUrl?: string | null
  espnId?: string
  riId?: string
  nbaId?: string
  mlbId?: string
  nhlId?: string
  pgaId?: string
  size?: number
  className?: string
  /** rounded-full for roster rows; rounded-[8px] for card-style */
  variant?: 'round' | 'card'
}

export type PlayerImageUrlOpts = {
  headshotUrl?: string | null
  riId?: string
  nbaId?: string
  mlbId?: string
  nhlId?: string
  pgaId?: string
}

/** First URL in the sport-specific headshot chain (for SSR or static markup). */
export function getPlayerImageUrl(
  sleeperId: string,
  sport: string = 'nfl',
  espnId?: string,
  opts?: PlayerImageUrlOpts,
): string {
  const enriched = buildEnrichedPlayer({
    sleeper_id: sleeperId,
    full_name: '',
    position: '',
    team: '',
    sport,
    espn_id: espnId,
    ri_id: opts?.riId,
    headshot_url: opts?.headshotUrl ?? undefined,
    nba_id: opts?.nbaId,
    mlb_id: opts?.mlbId,
    nhl_id: opts?.nhlId,
    pga_id: opts?.pgaId,
  })
  return resolveHeadshot(enriched)
}

function positionBgClass(position: string | undefined): string {
  const p = (position || '').toUpperCase()
  if (p === 'QB') return 'bg-red-500/80'
  if (p === 'RB') return 'bg-green-500/80'
  if (p === 'WR') return 'bg-blue-500/80'
  if (p === 'TE') return 'bg-orange-500/80'
  if (p === 'K') return 'bg-gray-500/80'
  if (p === 'DEF' || p === 'DST') return 'bg-purple-500/80'
  if (['SP', 'F', 'G', 'C', 'PF', 'PG', 'SG', 'SF'].includes(p)) return 'bg-indigo-500/80'
  return 'bg-slate-500/80'
}

function initialsFromName(name: string | undefined, position: string | undefined): string {
  const n = name?.trim()
  if (n) {
    const parts = n.split(/\s+/).filter(Boolean)
    if (parts.length >= 2) return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
    return n.slice(0, 2).toUpperCase()
  }
  const pos = position?.trim()
  if (pos) return pos.slice(0, 2).toUpperCase()
  return '?'
}

export function PlayerImage({
  sleeperId,
  sport = 'NFL',
  name,
  position,
  headshotUrl,
  espnId,
  riId,
  nbaId,
  mlbId,
  nhlId,
  pgaId,
  size = 32,
  className = '',
  variant = 'round',
}: PlayerImageProps) {
  const [fallbackIndex, setFallbackIndex] = useState(0)

  const urls = useMemo(() => {
    const enriched = buildEnrichedPlayer({
      sleeper_id: sleeperId,
      full_name: name ?? '',
      position: position ?? '',
      team: '',
      sport,
      espn_id: espnId,
      ri_id: riId,
      nba_id: nbaId,
      mlb_id: mlbId,
      nhl_id: nhlId,
      pga_id: pgaId,
      headshot_url: headshotUrl ?? undefined,
    })
    return resolveHeadshotCandidates(enriched)
  }, [sleeperId, sport, name, position, headshotUrl, espnId, riId, nbaId, mlbId, nhlId, pgaId])

  useEffect(() => {
    setFallbackIndex(0)
  }, [sleeperId, sport, espnId, riId, nbaId, mlbId, nhlId, pgaId, headshotUrl])

  const currentUrl = urls[fallbackIndex] ?? ''
  const exhausted = urls.length === 0 || fallbackIndex >= urls.length
  const radius = variant === 'card' ? 'rounded-[8px]' : 'rounded-full'

  if (exhausted || !currentUrl) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center border border-white/[0.12] text-[11px] font-bold text-white ${positionBgClass(position)} ${radius} ${className}`}
        style={{ width: size, height: size }}
        aria-hidden
      >
        {initialsFromName(name, position)}
      </div>
    )
  }

  return (
    <div
      className={`relative shrink-0 overflow-hidden border border-white/[0.12] ${radius} ${className}`}
      style={{ width: size, height: size }}
    >
      <img
        src={currentUrl}
        alt={name || 'Player'}
        className="h-full w-full object-cover"
        style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)' }}
        onError={() => setFallbackIndex((i) => i + 1)}
      />
    </div>
  )
}
