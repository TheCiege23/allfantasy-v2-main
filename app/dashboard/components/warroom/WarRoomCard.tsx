import type { CSSProperties, ReactNode } from 'react'

type WarRoomCardProps = {
  children: ReactNode
  className?: string
  style?: CSSProperties
  /** Adds a subtle colored border glow (hex/rgb), e.g. amber for urgency, emerald for clinched. */
  accentBorder?: string
  as?: 'div' | 'section'
}

/**
 * Shared dark "war room" card used across the redesigned dashboard home.
 * Fixed-dark by design (matches DashboardShell's bg-[#020713]) — does not
 * use the homepage's light-first CSS variables.
 *
 * Phase 4B: the subtle fade-up entrance (`warroom-fade-in-stagger`) is baked in
 * here so every dashboard card shares one consistent, restrained entrance instead
 * of each consumer opting in. Honors `prefers-reduced-motion`.
 */
export function WarRoomCard({ children, className, style, accentBorder, as = 'div' }: WarRoomCardProps) {
  const Tag = as
  return (
    <Tag
      className={`warroom-card warroom-fade-in-stagger rounded-2xl border ${className ?? ''}`}
      style={{
        // Broadcast Deck panel tokens — the same surface language as the league
        // page (.bdx): panel #12163e on ground #0b0e2a, border #262c6a.
        background: 'linear-gradient(180deg, rgba(18,22,62,0.94) 0%, rgba(11,14,42,0.94) 100%)',
        borderColor: accentBorder ?? '#262c6a',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        ...style,
      }}
    >
      {children}
    </Tag>
  )
}
