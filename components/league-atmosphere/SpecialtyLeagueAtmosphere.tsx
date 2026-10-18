'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

export type SpecialtyLeagueVariant = 'tournament' | 'survivor' | 'big_brother' | 'guillotine'

export type SpecialtyLeagueMood =
  | 'hoh'
  | 'veto'
  | 'eviction'
  | 'jury'
  | 'merge'
  | 'tribal'
  | 'exile'
  | 'championship'
  | 'bracket'
  | 'chop_week'
  | 'final'
  | 'eliminated'
  | 'default'

type Props = {
  variant: SpecialtyLeagueVariant
  /** Subtle accent shift (HOH glow, veto green, eviction dim, etc.) */
  mood?: SpecialtyLeagueMood | string | null
  className?: string
}

/**
 * Full-viewport immersive background for specialty league shells. Non-interactive; sits under UI.
 * Respects `prefers-reduced-motion` (disables particle/scanline motion, keeps gradients).
 */
export function SpecialtyLeagueAtmosphere({ variant, mood, className }: Props) {
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduceMotion(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  return (
    <div
      className={cn('pointer-events-none fixed inset-0 z-[0] overflow-hidden', className)}
      aria-hidden
      data-af-atmosphere={variant}
      data-af-mood={mood && mood !== 'default' ? mood : undefined}
    >
      <div
        className={cn(
          'af-atmo-layer absolute inset-0',
          variant === 'tournament' && 'af-atmo-tournament',
          variant === 'survivor' && 'af-atmo-survivor',
          variant === 'big_brother' && 'af-atmo-big-brother',
          variant === 'guillotine' && 'af-atmo-guillotine',
          mood && mood !== 'default' && `af-atmo-mood--${String(mood).replace(/[^a-z0-9_-]/gi, '')}`,
          reduceMotion && 'af-atmo-static',
        )}
      />
      {!reduceMotion && variant === 'tournament' ? (
        <div className="af-atmo-tournament-embers absolute inset-0" />
      ) : null}
      {!reduceMotion && variant === 'survivor' ? (
        <div className="af-atmo-survivor-torches absolute inset-0" />
      ) : null}
      {!reduceMotion && variant === 'big_brother' ? (
        <div className="af-atmo-bb-particles absolute inset-0" />
      ) : null}
      {!reduceMotion && variant === 'guillotine' ? (
        <div className="af-atmo-guillotine-embers absolute inset-0" />
      ) : null}
    </div>
  )
}
