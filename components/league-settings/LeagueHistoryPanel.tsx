'use client'

/**
 * components/league-settings/LeagueHistoryPanel.tsx
 * AF League History — read-only panel showing all historical seasons.
 * Merges imported (Sleeper) history with AF-native seasons into one unified list.
 * No changes can be made. Accessible to ALL league members.
 * Each year row is a different color for visual distinction.
 * Matches the Sleeper "Previous leagues" screenshot layout.
 */

import { useEffect, useState } from 'react'
import { Trophy } from 'lucide-react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HistorySeason {
  season: number
  championName: string | null
  championAvatar: string | null
  runnerUpName: string | null
  regularSeasonWinnerName: string | null
  teamCount: number | null
  scoringFormat: string | null
  isDynasty: boolean
  status: string | null
}

// Rotating color palette for year labels — each year gets a distinct color
const YEAR_COLORS = [
  'text-cyan-300',
  'text-emerald-300',
  'text-violet-300',
  'text-amber-300',
  'text-pink-300',
  'text-blue-300',
  'text-orange-300',
  'text-teal-300',
  'text-rose-300',
  'text-indigo-300',
]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  leagueId: string
}

type BackfillStatus = {
  status: string
  startedAt: string | null
  completedAt: string | null
  error: string | null
}

export function LeagueHistoryPanel({ leagueId }: Props) {
  const { t } = useLanguage()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [seasons, setSeasons] = useState<HistorySeason[]>([])
  const [, setLeagueName] = useState<string | null>(null)
  const [backfill, setBackfill] = useState<BackfillStatus | null>(null)

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const load = () => {
      fetch(`/api/leagues/${encodeURIComponent(leagueId)}/history`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((data) => {
          if (!active) return
          if (data.error) { setError(data.error); return }
          setSeasons(data.seasons ?? [])
          setLeagueName(data.leagueName ?? null)
          setBackfill(data.historicalBackfill ?? null)
          // Poll while the background backfill is still running.
          if (data.historicalBackfill?.status === 'pending') {
            timer = setTimeout(load, 5000)
          }
        })
        .catch(() => { if (active) setError(t('history.loadFailed')) })
        .finally(() => { if (active) setLoading(false) })
    }
    load()
    return () => {
      active = false
      if (timer) clearTimeout(timer)
    }
  }, [leagueId])

  if (loading) {
    return <div className="py-8 text-center text-sm text-white/50">{t('common.loading')}</div>
  }

  if (error) {
    return (
      <div className="space-y-3">
        <p className="text-[13px] text-red-300/80">{error}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {backfill?.status === 'pending' && (
        <div className="rounded-lg border border-sky-500/30 bg-sky-500/[0.06] px-3 py-2 text-[12px] text-sky-100">
          {t('history.backfillPending')}
        </div>
      )}
      {backfill?.status === 'failed' && backfill.error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/[0.06] px-3 py-2 text-[12px] text-rose-100">
          <p>{t('history.backfillFailed')} {backfill.error}</p>
          <button
            type="button"
            onClick={async () => {
              await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/backfill/retry`, {
                method: 'POST',
                credentials: 'include',
              })
              setBackfill({ ...backfill, status: 'pending', error: null })
            }}
            className="mt-2 inline-flex items-center gap-1 rounded-full border border-rose-400/40 bg-rose-400/10 px-3 py-1 text-[11px] font-semibold text-rose-100 hover:bg-rose-400/20"
          >
            {t('history.retryBackfill')}
          </button>
        </div>
      )}
      {/* Season list — matching Sleeper's clean year layout */}
      {seasons.length === 0 ? (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] px-4 py-8 text-center">
          <p className="text-[13px] text-white/40">{t('history.noSeasons')}</p>
          <p className="mt-1 text-[11px] text-white/25">
            {t('history.noSeasonsHint')}
          </p>
        </div>
      ) : (
        <div className="space-y-0">
          {seasons.map((season, idx) => {
            const colorClass = YEAR_COLORS[idx % YEAR_COLORS.length]
            const isActive = season.status === 'active' || season.status === 'in_season'
            const isComplete = season.status === 'complete' || season.status === 'post_season'

            return (
              <div
                key={season.season}
                className="group border-b border-white/[0.06] px-1 py-4 last:border-0 transition hover:bg-white/[0.02]"
              >
                {/* Year label — each year a different color */}
                <div className="flex items-center justify-between">
                  <span className={`text-[18px] font-bold ${colorClass}`}>
                    {season.season}
                  </span>
                  {isActive && (
                    <span className="rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-emerald-300">
                      {t('history.active')}
                    </span>
                  )}
                  {isComplete && season.championName && (
                    <div className="flex items-center gap-1.5">
                      <Trophy className="h-3.5 w-3.5 text-amber-400/70" />
                      <span className="text-[11px] font-medium text-amber-200/70">
                        {season.championName}
                      </span>
                    </div>
                  )}
                </div>

                {/* Season details — shown compactly below the year */}
                {(season.championName || season.teamCount || season.scoringFormat) && (
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5">
                    {season.teamCount && (
                      <span className="text-[11px] text-white/30">
                        {season.teamCount} {t('history.teams')}
                      </span>
                    )}
                    {season.scoringFormat && (
                      <span className="text-[11px] text-white/30">
                        {season.scoringFormat.replace(/_/g, ' ').toUpperCase()}
                      </span>
                    )}
                    {season.isDynasty && (
                      <span className="text-[11px] text-white/30">{t('history.dynasty')}</span>
                    )}
                    {season.runnerUpName && isComplete && (
                      <span className="text-[11px] text-white/25">
                        {t('history.runnerUp')} {season.runnerUpName}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Footer info */}
      <div className="border-t border-white/[0.06] pt-3">
        <p className="text-[11px] leading-relaxed text-white/25">
          {t('history.footer')}
        </p>
      </div>
    </div>
  )
}
