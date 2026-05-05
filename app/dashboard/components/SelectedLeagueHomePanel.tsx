'use client'

import Link from 'next/link'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import type { UserLeague } from '@/app/dashboard/types'
import { buildLeagueFormatLabel, buildStatusConfig } from '@/lib/leagues/leagueFormatLabel'
import { getLeagueListDestinationHref } from '@/lib/dashboard/league-list-destination'

type SelectedLeagueHomePanelProps = {
  league: UserLeague
  onBackToOverview: () => void
}

export function SelectedLeagueHomePanel({ league, onBackToOverview }: SelectedLeagueHomePanelProps) {
  const status = buildStatusConfig(league.status)
  const formatLabel = buildLeagueFormatLabel({
    format: league.format,
    scoring: league.scoring,
    isDynasty: league.isDynasty,
    leagueVariant: league.leagueVariant,
    teamCount: league.teamCount,
    season: league.season,
  })
  const fullLeagueHref = getLeagueListDestinationHref(league)

  return (
    <div className="h-full min-h-0 overflow-y-auto [scrollbar-gutter:stable]" style={{ background: 'var(--bg)' }}>
      <div className="mx-auto w-full max-w-3xl space-y-5 px-6 py-6">
        <button
          type="button"
          onClick={onBackToOverview}
          className="inline-flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[12px] font-semibold text-white/75 transition hover:bg-white/[0.07] hover:text-white"
          data-testid="dashboard-league-home-back"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Dashboard home
        </button>

        <div>
          <p className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--muted2)' }}>
            League workspace
          </p>
          <h1 className="mt-1 text-2xl font-black" style={{ color: 'var(--text)' }}>
            {league.name}
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
            {(league.sport || 'NFL').toString()} · {formatLabel || `${league.teamCount}-team`}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${status.dotColor}`} />
            <span className={`text-[11px] font-semibold ${status.textColor}`}>{status.label}</span>
            {league.isCommissioner ? (
              <span className="rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                Commissioner
              </span>
            ) : null}
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
          <p className="text-[11px] text-white/45">
            Open the full league hub for draft room, roster, matchups, trades, and settings. This dashboard view
            keeps chat and My Leagues visible.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Link
              href={fullLeagueHref}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-cyan-500/20 px-4 py-2.5 text-center text-[13px] font-semibold text-cyan-200 transition hover:bg-cyan-500/30"
              data-testid="dashboard-league-home-open-full"
            >
              <ExternalLink className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
              Open full league hub
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
