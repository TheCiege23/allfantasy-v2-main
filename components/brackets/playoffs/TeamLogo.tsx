"use client"

import { useState } from "react"
import { getTeamLogoUrl, getTeamInitials } from "@/lib/playoffs/teamLogos"
import type { PlayoffLogoSport } from "@/lib/playoffs/teamLogos"

interface TeamLogoProps {
  teamName: string
  sport: PlayoffLogoSport
  /** Size in pixels. Defaults to 20. */
  size?: number
  className?: string
}

/**
 * Renders an ESPN CDN team logo image with an initials-circle fallback.
 * Uses a plain <img> tag (not next/image) so it works inside both
 * client and server-rendered contexts without layout constraints.
 */
export function TeamLogo({ teamName, sport, size = 20, className = "" }: TeamLogoProps) {
  const [failed, setFailed] = useState(false)

  const url = getTeamLogoUrl(teamName, sport)
  const initials = getTeamInitials(teamName)

  if (!url || failed) {
    // Fallback: styled initial circle matching the app's slate palette
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-full bg-slate-700 font-black text-white ${className}`}
        style={{
          width: size,
          height: size,
          fontSize: Math.max(7, Math.round(size * 0.38)),
          lineHeight: 1,
        }}
        aria-label={teamName}
      >
        {initials}
      </span>
    )
  }

  return (
    <img
      src={url}
      alt={teamName}
      width={size}
      height={size}
      className={`shrink-0 object-contain ${className}`}
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
      loading="lazy"
    />
  )
}
