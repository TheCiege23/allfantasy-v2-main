'use client'

import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

export interface SectionHeadingProps {
  /** The eyebrow label text. */
  children: ReactNode
  icon?: LucideIcon
  /**
   * Accent color (hex/rgb) for the leading bar + icon. Dashboard V2 uses this to
   * carry per-context identity: cyan (Global), amber (Commissioner), emerald
   * (Team). Defaults to a neutral white when omitted.
   */
  accent?: string
  /** Optional trailing content (a count chip, "view all", etc.), right-aligned. */
  trailing?: ReactNode
  className?: string
}

/**
 * Dashboard V2 Phase 3.7 — the shared section eyebrow. Formalizes the repeated
 * uppercase-tracking label into one premium primitive with a colored accent bar
 * and optional icon, giving the page a consistent, scannable hierarchy and each
 * context a distinct accent identity. Purely presentational.
 */
export function SectionHeading({ children, icon: Icon, accent, trailing, className }: SectionHeadingProps) {
  // Broadcast Deck kicker: heavy italic display label + accent bar. When no
  // per-context accent is given, the bar wears the deck's signature gradient.
  const color = accent ?? null
  return (
    <div className={`flex items-center gap-2 ${className ?? ''}`}>
      <span
        aria-hidden
        className="h-3.5 w-[3px] shrink-0 rounded-full"
        style={{ background: color ?? 'linear-gradient(180deg,#ff3d81,#ff8a3d)' }}
      />
      {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: color ?? '#ff8a3d' }} aria-hidden /> : null}
      <p className="truncate text-[11px] font-black uppercase italic tracking-widest text-[#c6cbf5]">{children}</p>
      {trailing ? <span className="ml-auto shrink-0">{trailing}</span> : null}
    </div>
  )
}

/** Per-context accent colors — aligned to the Broadcast Deck status ramp
 *  (league page tokens): pink-gradient anchor for Global, warn amber for
 *  Commissioner, ok green for Team. */
export const CONTEXT_ACCENT: Record<'global' | 'commissioner' | 'team', string> = {
  global: '#ff3d81', // deck signature pink — cross-league command center
  commissioner: '#ffc53d', // deck warn — operations / authority
  team: '#3ddc97', // deck ok — weekly win center
}
