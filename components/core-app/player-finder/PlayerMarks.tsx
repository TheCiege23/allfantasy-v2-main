'use client'

import { useState } from 'react'
import { teamLogoUrl } from '@/lib/core-app/teamLogo'

/**
 * The two small marks that make a player row read as a person and a club:
 * the headshot (with the one-letter tile when we hold no image, or the CDN
 * 404s it) and the team crest (rendered only for a club the registry knows,
 * and removed if the CDN refuses it).
 *
 * The failed src is remembered rather than a boolean, so a different player's
 * image in the same slot gets a fresh attempt.
 */

export function PlayerAvatar({ src, name, size = 32 }: { src: string | null; name: string; size?: number }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  if (!src || src === failedSrc) {
    return (
      <span className="af-pf-avatar af-pf-avatar--none" style={{ width: size, height: size }} aria-hidden>
        {name.trim().charAt(0).toUpperCase()}
      </span>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="af-pf-avatar"
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailedSrc(src)}
    />
  )
}

export function TeamLogo({ sport, team, size = 16 }: { sport: string | null; team: string | null; size?: number }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const src = teamLogoUrl(sport, team)
  if (!src || src === failedSrc) return null
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="af-pf-team-logo"
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailedSrc(src)}
    />
  )
}
