'use client'

/**
 * components/league-settings/LeagueHistoryPanel.tsx
 * AF League History — read-only panel showing all historical seasons.
 * Merges imported (Sleeper) history with AF-native seasons into one unified list.
 * No changes can be made. Accessible to ALL league members.
 * Each year row is a different color for visual distinction.
 * Matches the Sleeper "Previous leagues" screenshot layout.
 */

import { useEffect, useMemo, useState } from 'react'
import { Trophy } from 'lucide-react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import type { AllTimeStandingRow } from '@/lib/league/allTimeStandings'

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
  const [standings, setStandings] = useState<AllTimeStandingRow[]>([])

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
          setStandings(data.allTimeStandings ?? [])
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

      {standings.length > 0 ? <AllTimeStandings rows={standings} /> : null}

      {/* Footer info */}
      <div className="border-t border-white/[0.06] pt-3">
        <p className="text-[11px] leading-relaxed text-white/25">
          {t('history.footer')}
        </p>
      </div>
    </div>
  )
}

type StandingsSort = 'winPct' | 'titles' | 'points'

const pct = (n: number) => `${(n * 100).toFixed(1)}%`
const points = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 })

/**
 * All-time standings: every manager across every season on file (lib/league/allTimeStandings.ts).
 * The table scrolls sideways inside its card, so the page itself never does on a phone.
 */
function AllTimeStandings({ rows }: { rows: AllTimeStandingRow[] }) {
  const { t } = useLanguage()
  const [sort, setSort] = useState<StandingsSort>('winPct')
  const sorted = useMemo(() => {
    const copy = [...rows]
    if (sort === 'titles') copy.sort((a, b) => b.championships - a.championships || b.winPct - a.winPct)
    else if (sort === 'points') copy.sort((a, b) => b.totalPoints - a.totalPoints || b.winPct - a.winPct)
    return copy
  }, [rows, sort])
  const showActivity = rows.some((r) => r.moves != null || r.messages != null)

  return (
    <div className="space-y-2" data-testid="league-history-all-time">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wide text-white/45">{t('history.allTime.title')}</p>
        <div className="flex gap-1" role="radiogroup" aria-label={t('history.allTime.sortBy')}>
          {(
            [
              ['winPct', t('history.allTime.winPct')],
              ['titles', t('history.allTime.titles')],
              ['points', t('history.allTime.pf')],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={sort === key}
              onClick={() => setSort(key)}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                sort === key ? 'border-cyan-300 bg-cyan-400 text-[#04131a]' : 'border-white/[0.12] bg-white/[0.04] text-white/60'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-white/[0.08] bg-black/20">
        <table className="w-full min-w-[560px] text-left text-[12px]">
          <thead className="text-[11px] uppercase tracking-wide text-white/40">
            <tr>
              <th className="px-3 py-2 font-semibold">{t('history.allTime.manager')}</th>
              <th className="px-2 py-2 font-semibold">{t('history.allTime.record')}</th>
              <th className="px-2 py-2 font-semibold">{t('history.allTime.winPct')}</th>
              <th className="px-2 py-2 font-semibold">{t('history.allTime.pf')}</th>
              <th className="px-2 py-2 font-semibold">{t('history.allTime.pa')}</th>
              <th className="px-2 py-2 font-semibold">{t('history.allTime.titles')}</th>
              {showActivity ? <th className="px-2 py-2 font-semibold">{t('history.allTime.moves')}</th> : null}
              {showActivity ? <th className="px-2 py-2 font-semibold">{t('history.allTime.messages')}</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.06]">
            {sorted.map((r) => (
              <tr key={r.managerKey} className="text-white/80">
                <td className="px-3 py-2">
                  <span className="block font-semibold text-white">{r.managerName}</span>
                  <span className="text-[11px] text-white/40">
                    {t('history.allTime.seasons').replace('{{n}}', String(r.seasonsPlayed))} · {r.yearRange}
                  </span>
                </td>
                <td className="px-2 py-2 tabular-nums">
                  {r.totalWins}-{r.totalLosses}
                  {r.totalTies ? `-${r.totalTies}` : ''}
                </td>
                <td className="px-2 py-2 tabular-nums">{pct(r.winPct)}</td>
                <td className="px-2 py-2 tabular-nums">{points(r.totalPoints)}</td>
                <td className="px-2 py-2 tabular-nums">{points(r.totalPointsAgainst)}</td>
                <td className="px-2 py-2 tabular-nums">
                  {r.championships > 0 ? (
                    <span className="inline-flex items-center gap-1 text-amber-200">
                      <Trophy className="h-3 w-3" aria-hidden />
                      {r.championships}
                    </span>
                  ) : (
                    0
                  )}
                </td>
                {showActivity ? <td className="px-2 py-2 tabular-nums">{r.moves ?? '—'}</td> : null}
                {showActivity ? <td className="px-2 py-2 tabular-nums">{r.messages ?? '—'}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showActivity ? <p className="text-[11px] text-white/35">{t('history.allTime.activityNote')}</p> : null}
    </div>
  )
}
