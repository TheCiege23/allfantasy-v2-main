'use client'

import type { UserLeague } from '../types'
import { LeagueTypeIcon } from './LeagueTypeIcon'
import { resolveLeagueLogoSrc } from '@/lib/dashboard/league-logo-src'
import { useImageLoadFailed } from '@/hooks/useImageLoadFailed'

export function LeagueAvatar({ league, size = 32 }: { league: UserLeague; size?: number }) {
  const src = resolveLeagueLogoSrc(league.logoUrl, league.avatarUrl)
  const { ref, failed, onError } = useImageLoadFailed(src)

  // Previously the custom-logo branch returned early with no onError at all, so a 404 on a
  // commissioner-set logoUrl rendered a broken-image glyph with no way to fall through. Both
  // sources now share one resolver and one failure path — and the hook also catches a failure
  // that lands before hydration, which a bare onError misses on any server-rendered page.
  if (src && !failed) {
    return (
      <img
        ref={ref}
        src={src}
        alt={league.name}
        className="flex-shrink-0 rounded-[8px] object-cover"
        style={{ width: size, height: size }}
        onError={onError}
      />
    )
  }

  return <LeagueTypeIcon league={league} size={size} />
}
