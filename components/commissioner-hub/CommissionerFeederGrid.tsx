'use client'

/**
 * Shared feeder-league card grid for Tournament + Zombie universe hubs.
 *
 * Matches the create-league v2 `SelectableCard` visual vocabulary:
 *   - Responsive 2/3/4-up grid
 *   - Per-card accent blob at top (`ambientGlowStyle`-style)
 *   - Hover -translate-y-1, accent ring + glow
 *   - Clicks link to the feeder's league page
 */

import Link from 'next/link'
import type { ReactNode } from 'react'
import { ArrowUpRight } from 'lucide-react'
import type { AccentTone } from '@/lib/create-league-v2/theme'

export interface FeederCard {
  /** Unique ID used as React key (league ID, tournament-league ID, etc.). */
  id: string
  /** Destination URL — Tournament feeders → `/league/{id}`, Zombie → `/zombie/{id}`. */
  href: string
  /** League / feeder name. */
  name: string
  /** Sport label (e.g. "NFL"). Rendered as a small meta pill. */
  sport?: string | null
  /** Tier or conference label (e.g. "Alpha", "Midwest Conference"). */
  tierLabel?: string | null
  /** Invite code or join code (e.g. for commissioner copy). */
  inviteCode?: string | null
  /** Optional extra meta (replaces default meta row). */
  meta?: ReactNode
}

export interface CommissionerFeederGridProps {
  leagues: FeederCard[]
  accent: AccentTone
  /** Optional section title rendered above the grid. */
  title?: string
  /** Optional sub-hint rendered under the title. */
  hint?: string
  /** Optional trailing slot (e.g. "Create another league" CTA). */
  footer?: ReactNode
}

export function CommissionerFeederGrid({
  leagues,
  accent,
  title = 'Your leagues',
  hint,
  footer = null,
}: CommissionerFeederGridProps) {
  if (leagues.length === 0) {
    return (
      <section
        className="rounded-3xl border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-white/[0.01] p-6 text-center text-sm text-white/55"
        aria-label={title}
      >
        No linked leagues yet.
      </section>
    )
  }

  return (
    <section
      className="rounded-3xl border border-white/[0.08] bg-gradient-to-b from-white/[0.04] to-white/[0.015] p-5 sm:p-6"
      aria-label={title}
    >
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-[13px] font-bold uppercase tracking-[0.18em] text-white/55">
            {title}
          </h2>
          {hint ? (
            <p className="mt-1.5 text-xs leading-relaxed text-white/40">{hint}</p>
          ) : null}
        </div>
        <span className={`text-[11px] font-semibold uppercase tracking-wider ${accent.text}`}>
          {leagues.length} {leagues.length === 1 ? 'league' : 'leagues'}
        </span>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {leagues.map((card) => (
          <Link
            key={card.id}
            href={card.href}
            className={`group relative flex w-full flex-col items-start gap-1.5 overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-br from-white/[0.04] to-transparent p-4 text-left transition-all duration-300 ease-out hover:-translate-y-1 hover:border-white/20 hover:bg-white/[0.06] hover:shadow-[0_12px_40px_-12px_rgba(0,0,0,0.6)]`}
          >
            {/* Accent glow blob on hover */}
            <span
              className="pointer-events-none absolute -top-8 left-1/2 h-16 w-32 -translate-x-1/2 rounded-full opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-40"
              style={{ background: accent.hex }}
              aria-hidden
            />

            {/* Top row: meta pills + chevron */}
            <div className="relative flex w-full items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1.5">
                {card.sport ? (
                  <span className={`rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.14em] ${accent.text}`}>
                    {card.sport}
                  </span>
                ) : null}
                {card.tierLabel ? (
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/55">
                    {card.tierLabel}
                  </span>
                ) : null}
              </div>
              <ArrowUpRight
                className={`h-4 w-4 shrink-0 text-white/30 transition-colors duration-200 group-hover:${accent.text} group-hover:text-current`}
                aria-hidden
              />
            </div>

            {/* League name */}
            <span className="relative mt-1 line-clamp-2 text-sm font-semibold text-white/90 transition-colors group-hover:text-white">
              {card.name}
            </span>

            {/* Meta row */}
            {card.meta ? (
              <span className="relative mt-0.5 block w-full text-[11px] leading-snug text-white/45">
                {card.meta}
              </span>
            ) : card.inviteCode ? (
              <span className="relative mt-0.5 block w-full truncate text-[11px] leading-snug text-white/45">
                Invite: <span className="font-mono text-white/60">{card.inviteCode}</span>
              </span>
            ) : null}
          </Link>
        ))}
      </div>

      {footer ? <div className="mt-4">{footer}</div> : null}
    </section>
  )
}
