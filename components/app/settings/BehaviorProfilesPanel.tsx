'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Brain, RefreshCw } from 'lucide-react'
import type { LeagueTabProps } from '@/components/app/tabs/types'
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'

type DimensionEvidence = {
  evidenceCount: number
  sufficient: boolean
  confidence: 'high' | 'moderate' | 'low' | null
}

type ProfileListRow = {
  id: string
  managerId: string
  sport: string
  sportLabel: string
  profileLabels: string[]
  aggressionScore: number
  activityScore: number
  tradeFrequencyScore: number
  waiverFocusScore: number
  riskToleranceScore: number
  updatedAt: string
  /** Set when this manager is someone else and the viewer is not entitled. */
  locked?: boolean
  lockedReason?: string
  /**
   * Evidence-gated scores. A null means UNMEASURED and must render as such. The
   * raw columns above are `Float @default(0)`, so rounding them prints a
   * confident "Risk 0" for a manager nobody has ever watched.
   */
  displayScores?: {
    aggressionScore: number | null
    activityScore: number | null
    tradeFrequencyScore: number | null
    waiverFocusScore: number | null
    riskToleranceScore: number | null
  } | null
  evidenceSummary?: {
    dimensions: { trade: DimensionEvidence; draft: DimensionEvidence; roster: DimensionEvidence }
    observedDimensions: string[]
    missingDimensions: string[]
    anySufficient: boolean
  } | null
}

/**
 * A score we never measured prints as a dash, never as a number.
 *
 * `displayScores` is absent on profiles written before the gate existed. That is
 * also unmeasured, not an invitation to fall back to the raw column.
 */
function scoreText(value: number | null | undefined): string {
  return typeof value === 'number' ? String(Math.round(value)) : '—'
}

/** What was actually observed, in plain words, so a thin profile explains itself. */
function evidenceLine(profile: ProfileListRow): string | null {
  const summary = profile.evidenceSummary
  if (!summary) return null
  const parts: string[] = []
  const { trade, draft, roster } = summary.dimensions
  if (draft?.evidenceCount) parts.push(`${draft.evidenceCount} picks`)
  if (trade?.evidenceCount) parts.push(`${trade.evidenceCount} trade actions`)
  if (roster?.evidenceCount) parts.push(`${roster.evidenceCount} waiver claims`)
  if (parts.length === 0) return 'Nothing recorded for this manager yet.'
  const observed = summary.observedDimensions.length
    ? `Observed: ${summary.observedDimensions.join(', ')}.`
    : 'Not enough in any one area to describe how they play yet.'
  return `${parts.join(' · ')}. ${observed}`
}

export default function BehaviorProfilesPanel({ leagueId }: LeagueTabProps) {
  const router = useRouter()
  const [sportFilter, setSportFilter] = useState<string>('ALL')
  const [seasonFilter, setSeasonFilter] = useState<string>(String(new Date().getFullYear()))
  const [running, setRunning] = useState(false)
  const [loading, setLoading] = useState(true)
  const [profiles, setProfiles] = useState<ProfileListRow[]>([])
  const [explainByProfile, setExplainByProfile] = useState<Record<string, string>>({})
  const [explainLoadingId, setExplainLoadingId] = useState<string | null>(null)
  const [compareAId, setCompareAId] = useState('')
  const [compareBId, setCompareBId] = useState('')
  const [result, setResult] = useState<{
    total: number
    success: number
    failed: number
    results: Array<{ managerId: string; teamName?: string; ok: boolean; error?: string }>
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const managerOptions = useMemo(
    () => Array.from(new Set(profiles.map((p) => p.managerId))).sort((a, b) => a.localeCompare(b)),
    [profiles]
  )

  async function loadProfiles() {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ limit: '200' })
      if (sportFilter !== 'ALL') params.set('sport', sportFilter)
      if (seasonFilter) params.set('season', seasonFilter)
      const res = await fetch(
        `/api/leagues/${encodeURIComponent(leagueId)}/psychological-profiles?${params.toString()}`,
        { cache: 'no-store' }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error ?? 'Failed to load profiles')
        setProfiles([])
        return
      }
      setProfiles(Array.isArray(data.profiles) ? data.profiles : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load profiles')
      setProfiles([])
    } finally {
      setLoading(false)
    }
  }

  async function buildAll() {
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const seasonNumber = Number(seasonFilter)
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/psychological-profiles/run-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(sportFilter !== 'ALL' ? { sport: sportFilter } : {}),
          ...(!Number.isNaN(seasonNumber) ? { season: seasonNumber } : {}),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error ?? 'Failed to run')
        return
      }
      setResult({
        total: data.total ?? 0,
        success: data.success ?? 0,
        failed: data.failed ?? 0,
        results: Array.isArray(data.results) ? data.results : [],
      })
      router.refresh()
      await loadProfiles()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setRunning(false)
    }
  }

  async function explain(profileId: string) {
    if (explainByProfile[profileId]) {
      setExplainByProfile((prev) => {
        const next = { ...prev }
        delete next[profileId]
        return next
      })
      return
    }
    setExplainLoadingId(profileId)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/psychological-profiles/explain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId }),
      })
      const data = await res.json().catch(() => ({}))
      setExplainByProfile((prev) => ({
        ...prev,
        [profileId]: data?.narrative ?? 'No explanation available.',
      }))
    } catch {
      setExplainByProfile((prev) => ({
        ...prev,
        [profileId]: 'Could not load explanation.',
      }))
    } finally {
      setExplainLoadingId(null)
    }
  }

  useEffect(() => {
    void loadProfiles()
  }, [leagueId, sportFilter, seasonFilter])

  return (
    <section className="rounded-xl border border-white/10 bg-black/20 p-4">
      <h3 className="text-sm font-semibold text-white flex items-center gap-2">
        <Brain className="h-4 w-4 text-purple-400" />
        Behavior Profiles
      </h3>
      <p className="mt-2 text-xs text-white/65">
        Generate and audit manager behavior profiles from draft/trade/waiver/lineup history. Profiles power manager style badges in rankings, trade workflows, and draft context.
      </p>
      <div className="mt-3 grid gap-2 md:grid-cols-3">
        <select
          value={sportFilter}
          onChange={(e) => setSportFilter(e.target.value)}
          className="rounded-lg border border-white/20 bg-black/30 px-3 py-2 text-xs text-white/80"
          aria-label="Behavior profile sport filter"
        >
          <option value="ALL">All sports</option>
          {SUPPORTED_SPORTS.map((s) => (
            <option key={s} value={s}>
              {s === 'NCAAB' ? 'NCAA Basketball' : s === 'NCAAF' ? 'NCAA Football' : s}
            </option>
          ))}
        </select>
        <input
          type="number"
          value={seasonFilter}
          onChange={(e) => setSeasonFilter(e.target.value)}
          className="rounded-lg border border-white/20 bg-black/30 px-3 py-2 text-xs text-white/80"
          aria-label="Behavior profile season filter"
          placeholder="Season"
        />
        <button
          type="button"
          onClick={() => void loadProfiles()}
          className="rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-xs text-white/80 hover:bg-white/10"
        >
          Refresh profiles
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={buildAll}
          disabled={running}
          className="inline-flex items-center gap-2 rounded-lg border border-purple-500/40 bg-purple-500/15 px-4 py-2 text-sm font-medium text-purple-200 hover:bg-purple-500/25 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${running ? 'animate-spin' : ''}`} />
          {running ? 'Building…' : 'Build behavior profiles'}
        </button>
        {compareAId && compareBId && (
          <Link
            href={`/app/league/${encodeURIComponent(
              leagueId
            )}/psychological-profiles/compare?managerAId=${encodeURIComponent(
              compareAId
            )}&managerBId=${encodeURIComponent(compareBId)}${
              sportFilter !== 'ALL' ? `&sport=${encodeURIComponent(sportFilter)}` : ''
            }`}
            className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-xs text-cyan-200 hover:bg-cyan-500/20"
          >
            Compare selected managers
          </Link>
        )}
        <Link
          href={`/app/league/${encodeURIComponent(leagueId)}/psychological-profiles`}
          className="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-white/5 px-4 py-2 text-xs text-white/80 hover:bg-white/10"
        >
          Open profile dashboard
        </Link>
      </div>
      {error && (
        <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <select
          value={compareAId}
          onChange={(e) => setCompareAId(e.target.value)}
          className="rounded-lg border border-white/20 bg-black/30 px-3 py-2 text-xs text-white/80"
          aria-label="Behavior comparison manager A"
        >
          <option value="">Manager A</option>
          {managerOptions.map((m) => (
            <option key={`a-${m}`} value={m}>
              {m}
            </option>
          ))}
        </select>
        <select
          value={compareBId}
          onChange={(e) => setCompareBId(e.target.value)}
          className="rounded-lg border border-white/20 bg-black/30 px-3 py-2 text-xs text-white/80"
          aria-label="Behavior comparison manager B"
        >
          <option value="">Manager B</option>
          {managerOptions.map((m) => (
            <option key={`b-${m}`} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
      {result && (
        <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/80">
          <p>
            Processed {result.total} managers — {result.success} succeeded, {result.failed} failed.
          </p>
          {result.results.some((r) => !r.ok) && (
            <ul className="mt-2 space-y-0.5 text-white/60">
              {result.results.filter((r) => !r.ok).map((r) => (
                <li key={r.managerId}>
                  {r.teamName ?? r.managerId}: {r.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="mt-4 space-y-2">
        {loading ? (
          <p className="text-xs text-white/60">Loading profiles...</p>
        ) : profiles.length === 0 ? (
          <p className="text-xs text-white/60">No profiles found. Build profiles to populate manager behavior cards.</p>
        ) : (
          profiles.map((profile) => (
            <article key={profile.id} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-white/90">{profile.managerId}</span>
                <span className="text-[10px] rounded border border-white/20 px-1.5 py-0.5 text-white/60">
                  {profile.sportLabel}
                </span>
                <div className="flex flex-wrap gap-1">
                  {profile.profileLabels.length > 0 ? (
                    profile.profileLabels.slice(0, 4).map((label) => (
                      <span
                        key={`${profile.id}-${label}`}
                        className="rounded border border-purple-500/25 bg-purple-500/10 px-1.5 py-0.5 text-[10px] text-purple-200"
                      >
                        {label}
                      </span>
                    ))
                  ) : (
                    // An empty label strip reads as "nothing notable about this
                    // manager". It actually means we have not watched them enough
                    // to say anything, which is a different statement.
                    <span className="rounded border border-white/15 bg-white/[0.03] px-1.5 py-0.5 text-[10px] text-white/45">
                      {profile.locked ? 'Locked' : 'Not enough activity yet'}
                    </span>
                  )}
                </div>
                <div className="ml-auto flex flex-wrap gap-1">
                  <Link
                    href={`/app/league/${encodeURIComponent(leagueId)}/psychological-profiles/${encodeURIComponent(profile.id)}`}
                    className="rounded border border-white/20 bg-white/5 px-2 py-0.5 text-[10px] text-white/75 hover:bg-white/10"
                  >
                    Profile details
                  </Link>
                  <Link
                    href={`/app/league/${encodeURIComponent(leagueId)}/psychological-profiles/${encodeURIComponent(profile.id)}?tab=evidence`}
                    className="rounded border border-white/20 bg-white/5 px-2 py-0.5 text-[10px] text-white/75 hover:bg-white/10"
                  >
                    Why this profile?
                  </Link>
                  <Link
                    href={`/league/${encodeURIComponent(leagueId)}?tab=Trades`}
                    className="rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-200 hover:bg-cyan-500/20"
                  >
                    Trade context
                  </Link>
                  <button
                    type="button"
                    onClick={() => void explain(profile.id)}
                    className="rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-200 hover:bg-cyan-500/20"
                  >
                    {explainLoadingId === profile.id
                      ? 'Explaining...'
                      : explainByProfile[profile.id]
                        ? 'Hide explain'
                        : 'Explain this manager style'}
                  </button>
                </div>
              </div>
              <div className="mt-2 grid grid-cols-5 gap-1.5 text-[10px] text-white/65">
                <div>Agg {scoreText(profile.displayScores?.aggressionScore)}</div>
                <div>Act {scoreText(profile.displayScores?.activityScore)}</div>
                <div>Trade {scoreText(profile.displayScores?.tradeFrequencyScore)}</div>
                <div>Waiver {scoreText(profile.displayScores?.waiverFocusScore)}</div>
                <div>Risk {scoreText(profile.displayScores?.riskToleranceScore)}</div>
              </div>
              {evidenceLine(profile) ? (
                <p className="mt-1.5 text-[10px] text-white/45">{evidenceLine(profile)}</p>
              ) : null}
              {profile.locked ? (
                <p className="mt-1.5 text-[10px] text-amber-200/80">
                  {profile.lockedReason ?? 'Other managers are a premium capability.'}{' '}
                  <Link href="/pricing" className="underline hover:text-amber-100">
                    Unlock
                  </Link>
                </p>
              ) : null}
              {explainByProfile[profile.id] && (
                <p className="mt-2 text-xs text-white/70">{explainByProfile[profile.id]}</p>
              )}
            </article>
          ))
        )}
      </div>
    </section>
  )
}
