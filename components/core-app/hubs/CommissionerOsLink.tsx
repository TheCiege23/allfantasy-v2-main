'use client'

import type { ReactNode } from 'react'
import { ACTIVE_LEAGUE_COOKIE_KEY } from '@/lib/commissioner-ui/activeLeague/constants'

/**
 * A link into Commissioner OS that opens on a chosen league.
 *
 * Commissioner OS has no `?league=`: every module reads the league its header
 * selector saved in a cookie (`resolveActiveLeagueId`). This writes that cookie the
 * way the selector does, then navigates — so "Health trends in Commissioner OS"
 * from one league's hub lands on THAT league, not on whichever was picked last.
 *
 * ⚠ THE COOKIE IS A PREFERENCE, NOT A GRANT. `resolveActiveLeagueId` only honours
 * it for a league the session owns, so a co-commissioner who is handed this link
 * would still land on their own league (or the access notice). The hub therefore
 * offers it only to the league owner.
 */
export function CommissionerOsLink({
  href,
  leagueId = null,
  className,
  children,
}: {
  href: string
  leagueId?: string | null
  className?: string
  children: ReactNode
}) {
  return (
    <a
      className={className}
      href={href}
      onClick={() => {
        if (leagueId) document.cookie = `${ACTIVE_LEAGUE_COOKIE_KEY}=${encodeURIComponent(leagueId)}; path=/; max-age=31536000`
      }}
    >
      {children}
    </a>
  )
}
