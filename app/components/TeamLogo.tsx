'use client'

import { useEffect, useMemo, useState } from 'react'
import { getTeamLogoCandidates, isNoTeam } from '@/lib/players/teamLogos'
import { liveLogoOrNull } from '@/lib/sport-teams/knownDeadLogoGuess'

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
  if (s === 'NCAAF' || s === 'NCAAFB') return 'bg-amber-800'
  if (s === 'NCAAB' || s === 'NCAABB') return 'bg-orange-800'
  if (s === 'SOCCER') return 'bg-emerald-800'
  return 'bg-slate-600'
}

/** Words that carry no identity in a school or club name. */
const NAME_FILLER = new Set(['UNIVERSITY', 'OF', 'THE', 'AT', 'COLLEGE', 'FC', 'CF', 'AFC', 'SC'])

/**
 * Two letters that identify the team. An abbreviation ("KC", "UCLA") keeps its first two
 * characters; a name ("Ohio State University", "Real Madrid") uses its meaningful words' initials,
 * so college and soccer teams without a crest read "OS" / "RM" rather than "OH" / "RE".
 */
function initials(team: string): string {
  const t = team.trim().toUpperCase()
  const words = t.split(/[\s\-–—.]+/).filter((w) => w && !NAME_FILLER.has(w))
  if (words.length >= 2) return `${words[0]![0]}${words[1]![0]}`
  const one = words[0] ?? t
  return one.slice(0, 2) || '?'
}

export function TeamLogo({ teamAbbr, sport = 'nfl', logoUrl = null, size = 24, className = '' }: TeamLogoProps) {
  const [fallbackIndex, setFallbackIndex] = useState(0)
  const urls = useMemo(() => {
    const base = getTeamLogoCandidates(teamAbbr, sport)
    // A passed logo is tried first — unless it is a guess the CDN is known never to serve.
    const preferred = liveLogoOrNull(logoUrl)
    return preferred ? [preferred, ...base.filter((u) => u !== preferred)] : base
  }, [teamAbbr, sport, logoUrl])

  useEffect(() => {
    setFallbackIndex(0)
  }, [teamAbbr, sport, logoUrl])

  if (isNoTeam(teamAbbr)) {
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
