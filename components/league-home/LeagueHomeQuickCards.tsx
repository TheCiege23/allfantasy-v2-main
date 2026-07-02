'use client'

/**
 * Quick action cards for the league homepage.
 *
 * 4-up grid of accent-tinted glassmorphism cards: Draft / My Team / Chat / Settings.
 * Each is a plain <a> that links into an existing route — no new handlers needed.
 */

import Link from 'next/link'
import type { ComponentType } from 'react'
import { MessageSquare, Settings, ShieldCheck, Users, Wand2 } from 'lucide-react'
import type { AccentTone } from '@/lib/create-league-v2/theme'

export interface LeagueHomeQuickCardsProps {
  leagueId: string
  accent: AccentTone
  /** Optional override — if provided, the Team card links directly to a team page. */
  myTeamId?: string | null
}

interface QuickCard {
  label: string
  hint: string
  icon: ComponentType<{ className?: string }>
  href: string
}

export function LeagueHomeQuickCards({ leagueId, accent, myTeamId = null }: LeagueHomeQuickCardsProps) {
  const cards: QuickCard[] = [
    {
      label: 'Draft Room',
      hint: 'Board, queue, and timer',
      icon: Wand2,
      href: `/league/${leagueId}?tab=draft`,
    },
    {
      label: 'My Team',
      hint: 'Roster, starters, IR',
      icon: ShieldCheck,
      href: myTeamId
        ? `/league/${leagueId}?tab=team&teamId=${myTeamId}`
        : `/league/${leagueId}?tab=team`,
    },
    {
      label: 'League Chat',
      hint: 'Chat + league guide',
      icon: MessageSquare,
      href: `/league/${leagueId}?openChat=league`,
    },
    {
      label: 'Settings',
      hint: 'Rules, scoring, waivers',
      icon: Settings,
      href: `/league/${leagueId}?tab=settings`,
    },
  ]

  return (
    <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map((c) => {
        const Icon = c.icon
        return (
          <Link
            key={c.label}
            href={c.href}
            className="glass-panel group relative overflow-hidden p-4 text-left transition-all duration-300 hover:-translate-y-1 hover:border-brand-primary/25 hover:bg-surface-hover"
          >
            {/* Accent glow on hover */}
            <span
              className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 h-16 w-32 rounded-full opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-40"
              style={{ background: accent.hex }}
              aria-hidden
            />
            <span
              className={`relative mb-2 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-surface-muted ${accent.text} shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-colors duration-200 group-hover:bg-surface-hover`}
              aria-hidden
            >
              <Icon className="h-5 w-5" />
            </span>
            <span className="relative block text-sm font-semibold text-primary transition-colors group-hover:text-primary">
              {c.label}
            </span>
            <span className="relative mt-0.5 block text-[11px] leading-snug text-muted">
              {c.hint}
            </span>
          </Link>
        )
      })}
    </div>
  )
}

// Unused import guard (kept to make adding a 5th card trivial without reorganizing imports).
void Users
