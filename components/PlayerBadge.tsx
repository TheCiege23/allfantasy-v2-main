'use client'

import React, { useState } from 'react'
import Image from 'next/image'
import { resolveHeadshot, resolveTeamLogo, type PlayerMedia } from '@/lib/media-url'

const POS_COLORS: Record<string, string> = {
  QB: 'bg-red-500/20 text-red-300 border-red-500/30',
  RB: 'bg-green-500/20 text-green-300 border-green-500/30',
  WR: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  TE: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  K: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  PK: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  DEF: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  DL: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  LB: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  DB: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  EDGE: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
}

interface PlayerBadgeProps {
  name: string
  sleeperId?: string
  position?: string
  team?: string
  slot?: string
  size?: 'sm' | 'md' | 'lg'
  showTeamLogo?: boolean
  showPosition?: boolean
  showSlot?: boolean
  className?: string
  media?: PlayerMedia | null
}

export default function PlayerBadge({
  name,
  sleeperId,
  position,
  team,
  slot,
  size = 'md',
  showTeamLogo = true,
  showPosition = true,
  showSlot = false,
  className = '',
  media,
}: PlayerBadgeProps) {
  const [imgError, setImgError] = useState(false)
  const [logoError, setLogoError] = useState(false)

  const headshotUrl = resolveHeadshot(media, sleeperId)
  const teamLogo = resolveTeamLogo(media, team)

  const sizeMap = {
    sm: { img: 24, text: 'text-xs', gap: 'gap-1.5', pill: 'text-[11px] px-1 py-0' },
    md: { img: 32, text: 'text-sm', gap: 'gap-2', pill: 'text-[11px] px-1.5 py-0.5' },
    lg: { img: 40, text: 'text-base', gap: 'gap-2.5', pill: 'text-xs px-2 py-0.5' },
  }

  const s = sizeMap[size]
  const posClass = POS_COLORS[(position || '').toUpperCase()] || 'bg-white/10 text-white/50 border-white/20'

  return (
    <div className={`flex items-center ${s.gap} ${className}`}>
      <div className="relative flex-shrink-0">
        {headshotUrl && !imgError ? (
          <Image
            src={headshotUrl}
            alt={name}
            width={s.img}
            height={s.img}
            className="rounded-full object-cover bg-white/5"
            onError={() => setImgError(true)}
            unoptimized
          />
        ) : (
          <div
            className="rounded-full bg-white/10 flex items-center justify-center text-white/40"
            style={{ width: s.img, height: s.img, fontSize: s.img * 0.4 }}
          >
            {name.charAt(0).toUpperCase()}
          </div>
        )}

        {showTeamLogo && teamLogo && !logoError && (
          <Image
            src={teamLogo}
            alt={team || ''}
            width={size === 'sm' ? 12 : size === 'md' ? 14 : 16}
            height={size === 'sm' ? 12 : size === 'md' ? 14 : 16}
            className="absolute -bottom-0.5 -right-0.5 rounded-full bg-black/80 border border-white/10"
            onError={() => setLogoError(true)}
            unoptimized
          />
        )}
      </div>

      <div className="flex items-center gap-1 sm:gap-1.5 min-w-0 overflow-hidden">
        <span className={`${s.text} text-white font-medium truncate min-w-0`}>{name}</span>

        {showPosition && position && (
          <span className={`${s.pill} rounded border font-medium flex-shrink-0 ${posClass}`}>
            {position}
          </span>
        )}

        {team && !showTeamLogo && (
          <span className={`${s.pill} text-white/40 flex-shrink-0`}>{team}</span>
        )}

        {showSlot && slot && slot !== 'Starter' && (
          <span className={`${s.pill} rounded border bg-white/5 border-white/10 text-white/30 flex-shrink-0`}>
            {slot}
          </span>
        )}
      </div>
    </div>
  )
}

interface PlayerBadgeInlineProps {
  name: string
  sleeperId?: string
  position?: string
  team?: string
  media?: PlayerMedia | null
}

export function PlayerBadgeInline({ name, sleeperId, position, team, media }: PlayerBadgeInlineProps) {
  const [imgError, setImgError] = useState(false)
  const headshotSrc = resolveHeadshot(media, sleeperId)

  return (
    <span className="inline-flex items-center gap-1">
      {headshotSrc && !imgError ? (
        <Image
          src={headshotSrc}
          alt={name}
          width={18}
          height={18}
          className="rounded-full object-cover bg-white/5 inline-block"
          onError={() => setImgError(true)}
          unoptimized
        />
      ) : null}
      <span className="text-white">{name}</span>
      {position && (
        <span className={`text-[11px] px-1 rounded border font-medium ${POS_COLORS[(position || '').toUpperCase()] || 'bg-white/10 text-white/50 border-white/20'}`}>
          {position}
        </span>
      )}
      {team && <span className="text-white/40 text-[11px]">{team}</span>}
    </span>
  )
}

export { headshotUrl as getPlayerHeadshotUrl, teamLogoUrl as getTeamLogoUrl } from '@/lib/media-url'
export { NFL_TEAM_MAP as NFL_TEAM_ABBREV_MAP } from '@/lib/media-url'
