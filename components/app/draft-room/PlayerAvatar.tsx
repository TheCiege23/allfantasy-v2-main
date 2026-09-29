'use client'

/**
 * E.1 — shared player avatar for all draft surfaces (pool card, board cell, detail modal,
 * queue row). Resolves to one of:
 *   1. real player headshot (only when classifyAvatarSource() === 'headshot' and the image loads)
 *   2. silhouette + initials (data URI placeholders, team logos, missing URLs, load errors)
 *
 * Team logos are NEVER rendered as the main avatar for normal players — they may be passed
 * via `teamLogoUrl` and will be drawn as a small bottom-right badge overlay only.
 *
 * F.1 (DEF special case) — when `position === 'DEF'`, the row IS a team defense and the
 * team logo is the correct primary avatar. In that case the team logo is promoted to the
 * main avatar slot and the bottom-right badge is suppressed (it would be redundant). Falls
 * back to initials/silhouette if no usable team logo is provided.
 */

import React, { useState } from 'react'
import { LazyDraftImage } from './LazyDraftImage'
import { classifyAvatarSource, initialsFor, isDefRowForAvatar } from '@/lib/draft-room/classify-avatar-source'

export interface PlayerAvatarProps {
  /** Candidate URL — may be a real headshot, synthesized data URI, team logo, or null. */
  headshotUrl: string | null | undefined
  /** Used to render initials fallback (Bijan Robinson → BR, Ja'Marr Chase → JC). */
  displayName: string
  /** Optional small team-logo badge bottom-right. Same fallback rules — null hides the badge. */
  teamLogoUrl?: string | null
  teamAbbr?: string | null
  /** F.1 — when 'DEF', the team logo is promoted to the primary avatar (defenses
   * represent the team, not an individual player). All other positions follow
   * the standard rules (headshot → initials/silhouette; team logo is badge-only). */
  position?: string | null
  /** Outer size in px. Defaults to 40 (pool card). Use larger for modal headers. */
  size?: number
  /** Optional override testid base. Default 'player-avatar'. */
  testIdBase?: string
  className?: string
  /** When true, render a colored ring around the avatar (used for selection / on-clock). */
  highlighted?: boolean
}

export function PlayerAvatar({
  headshotUrl,
  displayName,
  teamLogoUrl,
  teamAbbr,
  position,
  size = 40,
  testIdBase = 'player-avatar',
  className = '',
  highlighted = false,
}: PlayerAvatarProps) {
  const source = classifyAvatarSource(headshotUrl)
  const [imgError, setImgError] = useState(false)
  const [defLogoError, setDefLogoError] = useState(false)
  const teamLogoSource = classifyAvatarSource(teamLogoUrl)
  const showTeamLogo = teamLogoSource === 'headshot' || teamLogoSource === 'team_logo_badge_only'

  // F.1 — DEF (team defense) rows promote the team logo to the primary avatar.
  // We only enter this branch when there's a usable logo URL; otherwise we fall
  // through to the standard headshot → initials/silhouette pipeline.
  const isDefRow = isDefRowForAvatar(position)
  const showDefLogoAsPrimary = isDefRow && showTeamLogo && !defLogoError

  const showImg = !showDefLogoAsPrimary && source === 'headshot' && !imgError

  const initials = initialsFor(displayName)
  const iconSize = Math.max(14, size * 0.55)
  const ringClass = highlighted ? 'ring-2 ring-cyan-400/50' : 'ring-1 ring-white/10'
  // For DEF rows the badge would duplicate the primary avatar — suppress it.
  const showBadge = !isDefRow
  const badgeSize = Math.max(12, Math.round(size * 0.36))

  return (
    <div
      className={`relative inline-block flex-shrink-0 ${className}`}
      style={{ width: size, height: size }}
      data-testid={`${testIdBase}-root`}
      data-avatar-source={
        showDefLogoAsPrimary ? 'def_team_logo' : showImg ? 'headshot' : 'fallback'
      }
      data-position={isDefRow ? 'DEF' : undefined}
    >
      {showDefLogoAsPrimary ? (
        <LazyDraftImage
          src={String(teamLogoUrl)}
          alt={`${teamAbbr ?? displayName} defense logo`}
          width={size}
          height={size}
          testId={`${testIdBase}-def-logo`}
          // Logos are square crops with padding — `object-contain` keeps the badge legible at
          // any size; rounded square (not full circle) so the logo isn't clipped. Background is
          // a neutral chip so light/dark logos remain readable.
          className={`rounded-xl object-contain bg-[#0a1228] p-1.5 ${ringClass}`}
          lazy
          onError={() => setDefLogoError(true)}
        />
      ) : showImg ? (
        <LazyDraftImage
          src={String(headshotUrl)}
          alt={displayName}
          width={size}
          height={size}
          testId={`${testIdBase}-image`}
          className={`rounded-full object-cover bg-white/10 ${ringClass}`}
          lazy
          onError={() => {
            if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
              // eslint-disable-next-line no-console
              console.warn('[PlayerAvatar] headshot failed to load', {
                displayName,
                headshotUrl,
              })
            }
            setImgError(true)
          }}
        />
      ) : (
        <div
          data-testid={`${testIdBase}-fallback`}
          className={`rounded-full bg-gradient-to-br from-white/[0.18] to-white/[0.06] border border-white/10 flex items-center justify-center text-white/70 font-semibold ${ringClass}`}
          style={{ width: size, height: size }}
          aria-label={`${displayName || 'Player'} avatar`}
        >
          <svg
            viewBox="0 0 24 24"
            width={iconSize}
            height={iconSize}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="absolute text-white/35"
            aria-hidden
          >
            <circle cx="12" cy="9" r="4" />
            <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
          </svg>
          <span
            className="relative font-bold text-white/90"
            style={{ fontSize: Math.max(9, size * 0.32) }}
            data-testid={`${testIdBase}-initials`}
          >
            {initials}
          </span>
        </div>
      )}
      {showBadge && showTeamLogo && teamLogoUrl ? (
        <span
          className="absolute -bottom-0.5 -right-0.5 inline-flex items-center justify-center rounded-md border border-white/15 bg-[#0a1228] p-px shadow-md"
          aria-hidden
        >
          <LazyDraftImage
            src={String(teamLogoUrl)}
            alt={teamAbbr ?? ''}
            width={badgeSize}
            height={badgeSize}
            testId={`${testIdBase}-team-logo`}
            className="rounded object-contain"
            lazy
          />
        </span>
      ) : showBadge && teamAbbr ? (
        <span
          className="absolute -bottom-0.5 -right-0.5 inline-flex items-center justify-center rounded-md border border-white/15 bg-[#0a1228] px-1 text-[11px] font-bold text-white/85 shadow-md"
          aria-hidden
        >
          {teamAbbr.slice(0, 3).toUpperCase()}
        </span>
      ) : null}
    </div>
  )
}
