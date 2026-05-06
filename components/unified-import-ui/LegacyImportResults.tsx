'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { markDashboardRankRefreshPending } from '@/lib/import/dashboardRankRefresh'

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
      className="fixed inset-0 z-[100] overflow-y-auto bg-[#040915] px-4 py-10"
      data-testid="legacy-import-results-screen"
    >
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-3xl flex-col">
        <div className="mb-8 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-400/80">
            Import complete
          </p>
          <h1 className="mt-2 text-3xl font-bold text-white sm:text-4xl">
            {variant === 'legacy_sleeper' ? 'Your Legacy Profile' : 'League imported'}
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
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
              <p className="text-[11px] uppercase tracking-wider text-white/45">Legacy score (XP)</p>
              <p className="mt-2 text-3xl font-bold text-white">{legacyScore ?? '—'}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
              <p className="text-[11px] uppercase tracking-wider text-white/45">Legacy tier</p>
              <p className="mt-2 text-xl font-semibold text-cyan-200">{tierName}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
              <p className="text-[11px] uppercase tracking-wider text-white/45">Win rate</p>
              <p className="mt-2 text-2xl font-bold text-white">
                {payload.stats?.win_percentage != null
                  ? `${Number(payload.stats.win_percentage).toFixed(1)}%`
                  : '—'}
              </p>
              {payload.stats?.record ? (
                <p className="mt-1 text-xs text-white/45">Record {payload.stats.record}</p>
              ) : null}
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
              <p className="text-[11px] uppercase tracking-wider text-white/45">AI system sync</p>
              <p className="mt-2 text-sm text-white/85">
                {payload.latest_ai_report?.rating != null
                  ? `Grade ${payload.latest_ai_report.rating} · ${payload.latest_ai_report.title ?? 'Report ready'}`
                  : 'Generating insights in the background'}
              </p>
            </div>
          </div>
        )}

        {variant === 'league_created' && leagueSuccess && (
          <div className="rounded-2xl border border-cyan-500/25 bg-cyan-500/5 p-6">
            <p className="text-sm font-semibold text-white">{leagueSuccess.leagueName}</p>
            <p className="mt-1 text-xs text-white/50">{leagueSuccess.sport.toUpperCase()} · ID linked</p>
            <Link
              href={`/league/${encodeURIComponent(leagueSuccess.leagueId)}`}
              className="mt-4 inline-flex rounded-xl bg-cyan-500 px-4 py-2 text-sm font-bold text-black hover:bg-cyan-400"
            >
              Open league
            </Link>
          </div>
        )}

        <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-center">
          <button
            type="button"
            onClick={() => goDashboard()}
            className="rounded-2xl bg-gradient-to-r from-cyan-500 to-purple-600 px-6 py-3 text-sm font-bold text-white shadow-lg hover:opacity-95"
          >
            Go to dashboard
          </button>
          <Link
            href="/af-rankings"
            className="inline-flex items-center justify-center rounded-2xl border border-white/15 bg-white/5 px-6 py-3 text-sm font-semibold text-white hover:bg-white/10"
          >
            View rankings
          </Link>
          <button
            type="button"
            onClick={onImportAnother}
            className="rounded-2xl border border-white/15 px-6 py-3 text-sm font-semibold text-white/85 hover:bg-white/5"
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
