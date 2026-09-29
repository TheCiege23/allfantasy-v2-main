'use client'

import { useEffect, useMemo, useState } from 'react'
import { getTeamLogoCandidates } from '@/lib/players/teamLogos'

type TeamLogoProps = {
  teamAbbr: string
  sport?: string
  logoUrl?: string | null
  size?: number
  className?: string
}

function sportFallbackClass(sport: string): string {
  const s = sport.toUpperCase()
  if (s === 'NFL') return 'bg-blue-800'
  if (s === 'NBA') return 'bg-red-800'
  if (s === 'MLB') return 'bg-blue-900'
  if (s === 'NHL') return 'bg-slate-700'
  return 'bg-slate-600'
}

function initials(abbr: string): string {
  const t = abbr.trim().toUpperCase()
  if (t.length >= 2) return t.slice(0, 2)
  return t || '?'
}

export function TeamLogo({ teamAbbr, sport = 'nfl', logoUrl = null, size = 24, className = '' }: TeamLogoProps) {
  const [fallbackIndex, setFallbackIndex] = useState(0)
  const urls = useMemo(() => {
    const base = getTeamLogoCandidates(teamAbbr, sport)
    const preferred = String(logoUrl ?? '').trim()
    return preferred ? [preferred, ...base.filter((u) => u !== preferred)] : base
  }, [teamAbbr, sport, logoUrl])

  useEffect(() => {
    setFallbackIndex(0)
  }, [teamAbbr, sport, logoUrl])

  if (!teamAbbr || teamAbbr === 'FA') {
    return (
      <div
        className={`flex shrink-0 items-center justify-center rounded-full border border-white/[0.12] text-[11px] font-bold text-white/50 ${sportFallbackClass(sport)} ${className}`}
        style={{ width: size, height: size }}
        aria-hidden
      >
        —
      </div>
    )
  }

  const currentUrl = urls[fallbackIndex] ?? ''
  const exhausted = urls.length === 0 || fallbackIndex >= urls.length

  if (exhausted || !currentUrl) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center rounded-full border border-white/[0.12] text-[11px] font-bold text-white/90 ${sportFallbackClass(sport)} ${className}`}
        style={{ width: size, height: size }}
        title={teamAbbr}
        aria-hidden
      >
        {initials(teamAbbr)}
      </div>
    )
  }

  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-full border border-white/[0.1] bg-white/[0.04] ${className}`}
      style={{ width: size, height: size }}
    >
      <img
        src={currentUrl}
        alt=""
        className="h-full w-full object-contain p-0.5"
        onError={() => setFallbackIndex((n) => n + 1)}
      />
    </div>
  )
}
