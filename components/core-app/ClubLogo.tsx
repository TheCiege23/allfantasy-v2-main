'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import { getTeamInfo } from '@/lib/team-abbrev'
import { logoUrlForAbbrev } from '@/lib/sport-teams/SportTeamMetadataRegistry'

/**
 * A small NFL club mark rendered beside a club name or code.
 *
 * Honesty rules, all deliberate:
 *  - `club` resolves through the 32-club table in lib/team-abbrev.ts (full
 *    name, mascot, city, code or alias). Anything that table cannot resolve
 *    renders NOTHING — the text stands alone. No default avatar, no initials
 *    bubble, no guessed URL.
 *  - NFL ONLY. Club codes collide across sports (HOU is the Texans, the
 *    Rockets and the Astros — see the loader note in lib/core-app/dash34.ts),
 *    so callers passing a bare code must gate on the row's sport first; this
 *    component's own table is NFL and cannot mis-resolve a full non-NFL name.
 *  - A failed image load hides the element entirely — never a broken-image
 *    glyph (`onError` flips to render-null).
 *
 * The mark loads from a.espncdn.com — the host every other team logo in this
 * repo already uses (SportTeamMetadataRegistry, app/components/TeamLogo.tsx,
 * next.config.js remotePatterns). Club marks are third-party trademarks shown
 * nominatively: they identify the real club named in the adjacent text.
 */
export function ClubLogo({
  club,
  size = 18,
  style,
}: {
  club: string | null | undefined
  size?: number
  style?: CSSProperties
}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setFailed(false)
  }, [club])
  const info = getTeamInfo(club)
  if (!info || failed) return null
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logoUrlForAbbrev('NFL', info.canonical)}
      alt=""
      aria-hidden
      width={size}
      height={size}
      loading="lazy"
      style={{
        width: size,
        height: size,
        objectFit: 'contain',
        display: 'inline-block',
        verticalAlign: '-0.18em',
        flexShrink: 0,
        ...style,
      }}
      onError={() => setFailed(true)}
    />
  )
}
