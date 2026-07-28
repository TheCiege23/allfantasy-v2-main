'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Trophy, TrendingUp, Sparkles, History } from 'lucide-react'
import { markDashboardRankRefreshPending } from '@/lib/import/dashboardRankRefresh'
import { ImportHealthIndicator } from './ImportHealthIndicator'
import { ImportWarningsCard } from './ImportWarningsCard'
import type { ImportHealthInput } from './import-health'

type LegacyProfilePayload = {
  profile?: {
    sleeper_username?: string
    display_name?: string | null
    avatar?: string | null
    ai_rating?: number | null
    ai_title?: string | null
  }
  ranking_preview?: {
    career?: { tier?: number; tier_name?: string; xp?: number }
    confidence?: { score?: number }
  } | null
  stats?: {
    win_percentage?: number
    seasons_imported?: number
    leagues_played?: number
    championships?: number
    playoffs?: number
    record?: string
  } | null
  league_history?: Array<{ league_id?: string; name?: string; season?: number }>
  latest_ai_report?: { rating?: number | null; title?: string | null } | null
  last_import?: { status?: string; progress?: number } | null
}

export type LeagueImportSuccessPayload = {
  leagueId: string
  leagueName: string
  sport: string
}

export type LegacyImportResultsProps = {
  variant: 'legacy_sleeper' | 'league_created'
  returnTo: string
  /** Sleeper username for profile fetch */
  sleeperUsername?: string
  leagueSuccess?: LeagueImportSuccessPayload | null
  onImportAnother: () => void
  onCompleteRedirect?: string
}

export function LegacyImportResults({
  variant,
  returnTo,
  sleeperUsername,
  leagueSuccess,
  onImportAnother,
  onCompleteRedirect,
}: LegacyImportResultsProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(variant === 'legacy_sleeper')
  const [error, setError] = useState<string | null>(null)
  const [payload, setPayload] = useState<LegacyProfilePayload | null>(null)
  // Phase 4.2 — capture the persisted warning counts fed by `ImportWarningsCard`
  // so the health indicator + summary share the same source.
  const [warningSummary, setWarningSummary] = useState<
    { error: number; warn: number; info: number; total: number } | null
  >(null)
  const handleSummary = useCallback(
    (s: { error: number; warn: number; info: number; total: number } | null) => {
      setWarningSummary(s)
    },
    [],
  )

  const healthInput: ImportHealthInput = {
    runStatus:
      payload?.last_import?.status === 'running'
        ? 'running'
        : payload?.last_import?.status === 'failed'
          ? 'failed'
          : payload?.last_import?.status === 'completed'
            ? 'completed'
            : null,
    progress: payload?.last_import?.progress ?? null,
    warningCounts: warningSummary
      ? { error: warningSummary.error, warn: warningSummary.warn, info: warningSummary.info }
      : null,
  }

  useEffect(() => {
    if (variant !== 'legacy_sleeper' || !sleeperUsername?.trim()) {
      setLoading(false)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(
          `/api/legacy/profile?sleeper_username=${encodeURIComponent(sleeperUsername.trim().toLowerCase())}`,
          { cache: 'no-store' }
        )
        const data = (await res.json()) as LegacyProfilePayload & { error?: string }
        if (!res.ok) {
          if (!cancelled) setError(typeof data.error === 'string' ? data.error : 'Could not load profile')
          return
        }
        if (!cancelled) setPayload(data)
      } catch {
        if (!cancelled) setError('Network error loading profile')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [variant, sleeperUsername])

  const goDashboard = () => {
    markDashboardRankRefreshPending()
    router.refresh()
    const target = onCompleteRedirect?.startsWith('/') ? onCompleteRedirect : returnTo
    router.push(`${target}${target.includes('?') ? '&' : '?'}rankSync=1`)
  }

  const tierName =
    payload?.ranking_preview?.career?.tier_name ??
    payload?.profile?.ai_title ??
    'Legacy tier'

  const legacyScore =
    payload?.ranking_preview?.career?.xp != null
      ? Math.round(Number(payload.ranking_preview.career.xp))
      : payload?.profile?.ai_rating != null
        ? Math.round(Number(payload.profile.ai_rating))
        : null

  return (
    <div
      className="af-import-shell fixed inset-0 z-[100] overflow-y-auto bg-[#040915] px-4 py-10"
      data-testid="legacy-import-results-screen"
    >
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-3xl flex-col">
        <div className="warroom-fade-in-stagger mb-8 text-center">
          <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/[0.08] px-3 py-1 text-[11px] font-black uppercase tracking-[0.24em] text-emerald-300">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.6)]" aria-hidden />
            Import Complete
          </div>
          <h1 className="text-3xl font-black tracking-tight text-transparent sm:text-4xl">
            <span className="bg-gradient-to-r from-cyan-300 via-cyan-200 to-white bg-clip-text">
              {variant === 'legacy_sleeper' ? 'Your Legacy Profile' : 'League Imported'}
            </span>
          </h1>
        </div>

        {variant === 'legacy_sleeper' && loading && (
          <div className="flex flex-1 items-center justify-center">
            <div className="h-12 w-12 animate-spin rounded-full border-2 border-cyan-400/30 border-t-cyan-400" />
          </div>
        )}

        {error && (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>
        )}

        {variant === 'legacy_sleeper' && !loading && payload && (
          <div className="space-y-5">
            {/* Import health indicator — surfaces the run's status/progress; when
                this variant runs the legacy pipeline, there's no leagueId to fetch
                warnings against, so the health input relies on `last_import`. */}
            <ImportHealthIndicator input={healthInput} />

            {/* Legacy stat cards — Dashboard V2 quality: warroom-card depth,
                lucide icons per tile, color-grammar text tones. */}
            <div className="grid gap-4 sm:grid-cols-2">
              <StatTile
                icon={<Sparkles className="h-4 w-4 text-cyan-300" aria-hidden />}
                label="Legacy score (XP)"
                value={legacyScore != null ? String(legacyScore) : '—'}
                valueClass="text-cyan-200"
              />
              <StatTile
                icon={<Trophy className="h-4 w-4 text-amber-300" aria-hidden />}
                label="Legacy tier"
                value={tierName}
                valueClass="text-amber-200"
                size="md"
              />
              <StatTile
                icon={<TrendingUp className="h-4 w-4 text-emerald-300" aria-hidden />}
                label="Win rate"
                value={
                  payload.stats?.win_percentage != null
                    ? `${Number(payload.stats.win_percentage).toFixed(1)}%`
                    : '—'
                }
                valueClass="text-emerald-300"
                sub={payload.stats?.record ? `Record ${payload.stats.record}` : undefined}
              />
              <StatTile
                icon={<Sparkles className="h-4 w-4 text-violet-300" aria-hidden />}
                label="AI system sync"
                value={
                  payload.latest_ai_report?.rating != null
                    ? `Grade ${payload.latest_ai_report.rating}`
                    : 'Syncing'
                }
                valueClass="text-violet-200"
                sub={
                  payload.latest_ai_report?.title ??
                  (payload.latest_ai_report?.rating == null
                    ? 'Generating insights in the background'
                    : undefined)
                }
                size="md"
              />
            </div>

            {/* Historical timeline — leagues imported from the previous_league_id chain.
                Real data only: only renders when the payload actually reports leagues. */}
            {(payload.league_history?.length ?? 0) > 0 && (
              <div
                data-testid="import-history-timeline"
                className="warroom-card warroom-fade-in-stagger overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]"
              >
                <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
                  <div className="flex items-center gap-2">
                    <History className="h-3.5 w-3.5 text-cyan-300/80" aria-hidden />
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-white/70">
                      Leagues imported <span className="ml-1 text-white/40">({payload.league_history?.length ?? 0})</span>
                    </p>
                  </div>
                  <p className="text-[10px] text-white/40">Public history</p>
                </div>
                <ul className="max-h-[220px] divide-y divide-white/[0.05] overflow-y-auto">
                  {(payload.league_history ?? []).slice(0, 12).map((row) => (
                    <li key={`${row.league_id ?? 'x'}-${row.season ?? '?'}`} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400/60" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-[13px] text-white/85">{row.name ?? 'Untitled league'}</span>
                      <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-black tabular-nums text-white/60">
                        {row.season ?? '—'}
                      </span>
                    </li>
                  ))}
                </ul>
                {(payload.league_history?.length ?? 0) > 12 ? (
                  <p className="border-t border-white/[0.05] px-4 py-2 text-center text-[11px] text-white/40">
                    Showing 12 of {payload.league_history?.length}
                  </p>
                ) : null}
              </div>
            )}
          </div>
        )}

        {variant === 'league_created' && leagueSuccess && (
          <div className="space-y-5">
            {/* Health indicator — driven by persisted warning counts fed from the
                warnings card. Refreshes when `handleSummary` fires. */}
            <ImportHealthIndicator
              input={{
                runStatus: 'completed',
                progress: 100,
                warningCounts: warningSummary
                  ? {
                      error: warningSummary.error,
                      warn: warningSummary.warn,
                      info: warningSummary.info,
                    }
                  : null,
              }}
            />

            {/* League summary card — Dashboard V2 quality confirmation + primary CTA. */}
            <div
              data-testid="import-league-summary"
              className="warroom-card warroom-fade-in-stagger overflow-hidden rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.05]"
            >
              <div className="h-1 bg-gradient-to-r from-emerald-400/70 via-cyan-400/50 to-emerald-400/70" />
              <div className="p-5">
                <div className="mb-3 flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/[0.10]">
                    <CheckCircle2 className="h-4 w-4 text-emerald-300" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[16px] font-black text-white">{leagueSuccess.leagueName}</p>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-white/50">
                      {leagueSuccess.sport.toUpperCase()} · ID linked
                    </p>
                  </div>
                </div>
                <Link
                  href={`/league/${encodeURIComponent(leagueSuccess.leagueId)}`}
                  className="warroom-pressable inline-flex rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-[13px] font-black text-white hover:bg-white/10"
                >
                  Open your connected league →
                </Link>
              </div>
            </div>

            {/* Persisted warnings card — reads from /api/leagues/[id]/import/warnings.
                Feeds counts back to the health indicator via handleSummary. */}
            <ImportWarningsCard leagueId={leagueSuccess.leagueId} onSummary={handleSummary} />
          </div>
        )}

        <div className="warroom-fade-in-stagger mt-10 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-center">
          <button
            type="button"
            onClick={() => goDashboard()}
            data-testid="import-go-dashboard"
            className="warroom-pressable rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 px-6 py-3 text-sm font-black text-white shadow-[0_10px_40px_-15px_rgba(34,211,238,0.75)]"
          >
            Go to my dashboard
          </button>
          <Link
            href="/af-rankings"
            className="warroom-pressable inline-flex items-center justify-center rounded-2xl border border-white/15 bg-white/5 px-6 py-3 text-sm font-black text-white hover:bg-white/10"
          >
            View rankings
          </Link>
          <button
            type="button"
            onClick={onImportAnother}
            className="warroom-pressable rounded-2xl border border-white/15 px-6 py-3 text-sm font-black text-white/85 hover:bg-white/5"
          >
            Import another
          </button>
        </div>

        <p className="mt-8 text-center text-[11px] text-white/30">
          Rankings and dashboard widgets refresh when you open the dashboard — look for updated legacy stats.
        </p>
      </div>
    </div>
  )
}

/** Small stat card — shared shape for the legacy_sleeper variant. */
function StatTile({
  icon,
  label,
  value,
  valueClass,
  sub,
  size = 'lg',
}: {
  icon: React.ReactNode
  label: string
  value: string
  valueClass: string
  sub?: string
  size?: 'md' | 'lg'
}) {
  return (
    <div className="warroom-card warroom-fade-in-stagger rounded-2xl border border-white/10 bg-white/[0.04] p-5">
      <div className="mb-2 flex items-center gap-1.5">
        {icon}
        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-white/50">{label}</p>
      </div>
      <p className={`font-black tabular-nums ${size === 'lg' ? 'text-3xl' : 'text-xl'} ${valueClass}`}>{value}</p>
      {sub ? <p className="mt-1 text-[11px] text-white/45">{sub}</p> : null}
    </div>
  )
}
