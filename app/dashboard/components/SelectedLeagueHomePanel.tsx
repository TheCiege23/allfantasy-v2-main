'use client'

import Link from 'next/link'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import type { UserLeague } from '@/app/dashboard/types'
import { getLeagueListDestinationHref } from '@/lib/dashboard/league-list-destination'

type SelectedLeagueHomePanelProps = {
  league: UserLeague
  onBackToOverview: () => void
}

/**
 * Full league hub UI is loaded from `/league/[id]?embed=1` so we reuse `LeagueShell`
 * without duplicating hub markup. The dashboard keeps left chat + My Leagues rails;
 * this panel is only the center column.
 */
export function SelectedLeagueHomePanel({ league, onBackToOverview }: SelectedLeagueHomePanelProps) {
  const fullLeagueHref = getLeagueListDestinationHref(league)
  const embedSrc = `/league/${encodeURIComponent(league.id)}?embed=1`

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" style={{ background: 'var(--bg)' }}>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] bg-[#050814]/95 px-4 py-2">
        <button
          type="button"
          onClick={onBackToOverview}
          className="inline-flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[12px] font-semibold text-white/75 transition hover:bg-white/[0.07] hover:text-white"
          data-testid="dashboard-league-home-back"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Dashboard home
        </button>
        <Link
          href={fullLeagueHref}
          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-white/45 transition hover:text-cyan-200/90"
          data-testid="dashboard-league-home-open-full-secondary"
        >
          <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
          Open full page
        </Link>
      </div>
      <iframe
        title={`${league.name} — league hub`}
        src={embedSrc}
        className="min-h-0 w-full flex-1 border-0 bg-[#040915]"
        data-testid="dashboard-embedded-league-hub-iframe"
      />
    </div>
  )
}
