'use client'

import React, { useState } from 'react'
import { resolveHeadshot, type PlayerMedia } from '@/lib/media-url'

interface MiniPlayerImgProps {
  sleeperId?: string | null
  name?: string
  size?: number
  className?: string
  media?: PlayerMedia | null
  avatarUrl?: string | null
  /**
   * Render the initials and fetch nothing.
   *
   * MARK NEEDED AS ITS OWN PROP BECAUSE `avatarUrl={null}` DOES NOT SUPPRESS
   * ANYTHING -- the component falls through to `resolveHeadshot(media, sleeperId)`
   * and fetches a headshot anyway. A caller trying to save bytes that way would
   * get the identical network traffic and no indication it had failed.
   *
   * Optional and defaulted off, so every existing caller is unaffected.
   */
  suppress?: boolean
}

export default function MiniPlayerImg({ sleeperId, name, size = 20, className = '', media, avatarUrl, suppress = false }: MiniPlayerImgProps) {
  const [error, setError] = useState(false)

  const src = suppress ? null : avatarUrl || resolveHeadshot(media, sleeperId || undefined)

  if (!src || error) {
    return (
      <div
        className={`rounded-full bg-white/10 flex items-center justify-center text-white/40 font-bold flex-shrink-0 ${className}`}
        style={{ width: size, height: size, fontSize: size * 0.4 }}
      >
        {name ? name.charAt(0).toUpperCase() : '?'}
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={name || ''}
      width={size}
      height={size}
      className={`rounded-full object-cover bg-white/5 flex-shrink-0 ${className}`}
      onError={() => setError(true)}
      loading="lazy"
    />
  )
}
