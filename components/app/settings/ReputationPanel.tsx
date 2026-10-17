'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Shield, RefreshCw, Award, TrendingUp, BookOpen, FileText, Loader2, Scale } from 'lucide-react'
import type { LeagueTabProps } from '@/components/app/tabs/types'
import { SUPPORTED_SPORTS, normalizeToSupportedSport, type SupportedSport } from '@/lib/sport-scope'

type ReputationTier = 'Legendary' | 'Elite' | 'Trusted' | 'Reliable' | 'Neutral' | 'Risky'

type ReputationRow = {
  managerId: string
  sport: SupportedSport
  season: number
  tier: ReputationTier
  overallScore: number
  reliabilityScore: number
  activityScore: number
  tradeFairnessScore: number
  sportsmanshipScore: number
  commissionerTrustScore: number
  toxicityRiskScore: number
  participationQualityScore: number
  responsivenessScore: number
  updatedAt: string
}

type EvidenceRow = {
  id: string
  managerId: string
  sport: SupportedSport
  season: number
  evidenceType: string
  value: number
  sourceReference: string | null
  createdAt: string
}

type ReputationConfigPayload = {
  sport: SupportedSport
  season: number
  tierThresholds: Record<ReputationTier, { min: number; max?: number }>
  scoreWeights: {
    reliability: number
    activity: number
    tradeFairness: number
    sportsmanship: number
    commissionerTrust: number
    toxicityRisk: number
    participationQuality: number
    responsiveness: number
  }
}

type ComparisonPayload = {
  managerA: ReputationRow | null
  managerB: ReputationRow | null
}

const TIERS: ReputationTier[] = ['Legendary', 'Elite', 'Trusted', 'Reliable', 'Neutral', 'Risky']

export default function ReputationPanel({ leagueId }: LeagueTabProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [running, setRunning] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)
  const [result, setResult] = useState<{
    processed: number
    created: number
    updated: number
    results?: Array<{ managerId: string; tier: string; overallScore: number }>
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reputations, setReputations] = useState<ReputationRow[]>([])
  const [loadingReputations, setLoadingReputations] = useState(true)
  const [sportFilter, setSportFilter] = useState<SupportedSport>(normalizeToSupportedSport('NFL'))
  const [seasonFilter, setSeasonFilter] = useState<string>(String(new Date().getUTCFullYear()))
  const [tierFilter, setTierFilter] = useState<string>('')
  const [selectedManagerId, setSelectedManagerId] = useState<string>('')
  const [selectedEvidenceType, setSelectedEvidenceType] = useState<string>('')
  const [explainNarrative, setExplainNarrative] = useState<string | null>(null)
  const [explainLoading, setExplainLoading] = useState(false)
  const [evidenceRows, setEvidenceRows] = useState<EvidenceRow[]>([])
  const [commissionerContext, setCommissionerContext] = useState<{
    lowTrustManagerIds: string[]
    highCommissionerTrustManagerIds: string[]
    reputationCoverageCount: number
  } | null>(null)
  const [aiPrestigeContext, setAiPrestigeContext] = useState<{
    governanceSummary?: string
    reputationSummary?: string
    legacySummary?: string
    hallOfFameSummary?: string
    combinedHint?: string
  } | null>(null)
  const [configDraft, setConfigDraft] = useState<ReputationConfigPayload | null>(null)
  const [compareAId, setCompareAId] = useState<string>('')
  const [compareBId, setCompareBId] = useState<string>('')
  const [comparison, setComparison] = useState<ComparisonPayload | null>(null)
  const [comparisonLoading, setComparisonLoading] = useState(false)

  const seasonNumber = useMemo(() => {
    const n = parseInt(seasonFilter, 10)
    return Number.isFinite(n) && !Number.isNaN(n) ? n : new Date().getUTCFullYear()
  }, [seasonFilter])

  const fetchReputations = useCallback(async () => {
    if (!leagueId) return
    setLoadingReputations(true)
    try {
      const params = new URLSearchParams({
        limit: '200',
        sport: sportFilter,
        season: String(seasonNumber),
      })
      if (tierFilter) params.set('tier', tierFilter)
      const res = await fetch(
        `/api/leagues/${encodeURIComponent(leagueId)}/reputation?${params.toString()}`,
        { cache: 'no-store' }
      )
      const data = (await res.json().catch(() => ({}))) as {
        reputations?: ReputationRow[]
        error?: string
      }
      if (!res.ok) throw new Error(data.error || 'Failed to load reputations')
      const list = Array.isArray(data.reputations) ? data.reputations : []
      setReputations(list)
      const preferredManager = String(searchParams?.get('reputationManagerId') ?? '').trim()
      setSelectedManagerId((prev) => {
        if (preferredManager && list.some((row) => row.managerId === preferredManager)) return preferredManager
        if (prev && list.some((row) => row.managerId === prev)) return prev
        return list[0]?.managerId ?? ''
      })
      setCompareAId((prev) => {
        if (prev && list.some((row) => row.managerId === prev)) return prev
        return list[0]?.managerId ?? ''
      })
      setCompareBId((prev) => {
        if (prev && list.some((row) => row.managerId === prev)) return prev
        return list[1]?.managerId ?? list[0]?.managerId ?? ''
      })
    } catch (e: any) {
      setError(e?.message || 'Failed to load reputations')
      setReputations([])
    } finally {
      setLoadingReputations(false)
    }
  }, [leagueId, seasonNumber, searchParams, sportFilter, tierFilter])

  const fetchConfig = useCallback(async () => {
    if (!leagueId) return
    const params = new URLSearchParams({ sport: sportFilter, season: String(seasonNumber) })
    const res = await fetch(
      `/api/leagues/${encodeURIComponent(leagueId)}/reputation/config?${params.toString()}`,
      { cache: 'no-store' }
    )
    const data = (await res.json().catch(() => ({}))) as {
      config?: ReputationConfigPayload
      error?: string
    }
    if (!res.ok) throw new Error(data.error || 'Failed to load reputation config')
    if (data.config) setConfigDraft(data.config)
  }, [leagueId, seasonNumber, sportFilter])

  const fetchCommissionerContext = useCallback(async () => {
    if (!leagueId) return
    const params = new URLSearchParams({ sport: sportFilter })
    const res = await fetch(
      `/api/leagues/${encodeURIComponent(leagueId)}/prestige-context?${params.toString()}`,
      { cache: 'no-store' }
    )
    if (!res.ok) {
      setCommissionerContext(null)
      return
    }
    const data = (await res.json().catch(() => ({}))) as {
      commissionerContext?: {
        lowTrustManagerIds: string[]
        highCommissionerTrustManagerIds: string[]
        reputationCoverageCount: number
      }
      aiContext?: {
        governanceSummary?: string
        reputationSummary?: string
        legacySummary?: string
        hallOfFameSummary?: string
        combinedHint?: string
      }
    }
    setCommissionerContext(data.commissionerContext ?? null)
    setAiPrestigeContext(data.aiContext ?? null)
  }, [leagueId, sportFilter])

  useEffect(() => {
    let active = true
    async function loadAll() {
      setError(null)
      try {
        await Promise.all([fetchReputations(), fetchConfig(), fetchCommissionerContext()])
      } catch (e: any) {
        if (active) setError(e?.message || 'Failed to load reputation context')
      }
    }
    void loadAll()
    return () => {
      active = false
    }
  }, [fetchCommissionerContext, fetchConfig, fetchReputations])

  async function refreshAll() {
    setRefreshing(true)
    setError(null)
    try {
      await Promise.all([fetchReputations(), fetchConfig(), fetchCommissionerContext()])
      setExplainNarrative(null)
      setEvidenceRows([])
      setComparison(null)
    } catch (e: any) {
      setError(e?.message || 'Refresh failed')
    } finally {
      setRefreshing(false)
    }
  }

  async function explainManager() {
    if (!selectedManagerId) return
    setExplainLoading(true)
    setExplainNarrative(null)
    setEvidenceRows([])
    try {
      const params = new URLSearchParams({
        managerId: selectedManagerId,
        sport: sportFilter,
        season: String(seasonNumber),
        limit: '30',
      })
      if (selectedEvidenceType) params.set('evidenceType', selectedEvidenceType)
      const [explainRes, evidenceRes] = await Promise.all([
        fetch(`/api/leagues/${encodeURIComponent(leagueId)}/reputation/explain`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            managerId: selectedManagerId,
            sport: sportFilter,
            season: seasonNumber,
          }),
        }),
        fetch(`/api/leagues/${encodeURIComponent(leagueId)}/reputation/evidence?${params.toString()}`),
      ])
      const explainData = await explainRes.json().catch(() => ({}))
      const evidenceData = await evidenceRes.json().catch(() => ({}))
      setExplainNarrative(explainData?.narrative ?? explainData?.error ?? 'No explanation available.')
      setEvidenceRows(Array.isArray(evidenceData?.evidence) ? evidenceData.evidence : [])
    } catch {
      setExplainNarrative('Failed to load explanation.')
    } finally {
      setExplainLoading(false)
    }
  }

  async function runComparison() {
    if (!compareAId || !compareBId) return
    setComparisonLoading(true)
    setComparison(null)
    try {
      const params = new URLSearchParams({
        managerAId: compareAId,
        managerBId: compareBId,
        sport: sportFilter,
        season: String(seasonNumber),
      })
      const res = await fetch(
        `/api/leagues/${encodeURIComponent(leagueId)}/reputation/compare?${params.toString()}`,
        { cache: 'no-store' }
      )
      const data = (await res.json().catch(() => ({}))) as {
        comparison?: ComparisonPayload
        error?: string
      }
      if (!res.ok) throw new Error(data.error || 'Failed to compare managers')
      setComparison(data.comparison ?? null)
    } catch (e: any) {
      setError(e?.message || 'Manager comparison failed')
    } finally {
      setComparisonLoading(false)
    }
  }

  async function saveConfig() {
    if (!configDraft) return
    setSavingConfig(true)
    setError(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/reputation/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sport: sportFilter,
          season: seasonNumber,
          tierThresholds: configDraft.tierThresholds,
          scoreWeights: configDraft.scoreWeights,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        config?: ReputationConfigPayload
        error?: string
      }
      if (!res.ok) throw new Error(data.error || 'Failed to save reputation config')
      if (data.config) setConfigDraft(data.config)
      await fetchReputations()
    } catch (e: any) {
      setError(e?.message || 'Failed to save reputation config')
    } finally {
      setSavingConfig(false)
    }
  }

  async function runEngine() {
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/reputation/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sport: sportFilter,
          season: seasonNumber,
          replace: true,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error ?? 'Failed to run')
        return
      }
      setResult({
        processed: data.processed ?? 0,
        created: data.created ?? 0,
        updated: data.updated ?? 0,
        results: data.results ?? [],
      })
      await fetchReputations()
      await fetchCommissionerContext()
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setRunning(false)
    }
  }

  const trustSummary = useMemo(() => {
    if (!commissionerContext) return null
    return {
      lowTrust: commissionerContext.lowTrustManagerIds.length,
      highTrust: commissionerContext.highCommissionerTrustManagerIds.length,
      coverage: commissionerContext.reputationCoverageCount,
    }
  }, [commissionerContext])

  return (
    <section className="rounded-xl border border-white/10 bg-black/20 p-4">
      <h3 className="text-sm font-semibold text-white flex items-center gap-2">
        <Shield className="h-4 w-4 text-cyan-400" />
        Reputation System
      </h3>
      <p className="mt-2 text-xs text-white/65">
        Compute trust scores (reliability, activity, trade fairness, sportsmanship, commissioner trust, toxicity risk) for every manager. Scores are evidence-based and configurable by sport and season.
      </p>
      <div className="mt-3 grid gap-2 md:grid-cols-4">
        <div>
          <label className="text-[11px] text-white/60">Sport</label>
          <select
            value={sportFilter}
            onChange={(e) => setSportFilter(normalizeToSupportedSport(e.target.value))}
            className="mt-1 w-full rounded-lg bg-zinc-950 border border-zinc-800 px-2 py-1.5 text-xs text-white"
            aria-label="Reputation sport filter"
            data-testid="reputation-sport-filter"
          >
            {SUPPORTED_SPORTS.map((sport) => (
              <option key={sport} value={sport}>
                {sport === 'NCAAB' ? 'NCAA Basketball' : sport === 'NCAAF' ? 'NCAA Football' : sport}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[11px] text-white/60">Season</label>
          <input
            value={seasonFilter}
            onChange={(e) => setSeasonFilter(e.target.value)}
            className="mt-1 w-full rounded-lg bg-zinc-950 border border-zinc-800 px-2 py-1.5 text-xs text-white"
            aria-label="Reputation season filter"
            data-testid="reputation-season-filter"
          />
        </div>
        <div>
          <label className="text-[11px] text-white/60">Tier</label>
          <select
            value={tierFilter}
            onChange={(e) => setTierFilter(e.target.value)}
            className="mt-1 w-full rounded-lg bg-zinc-950 border border-zinc-800 px-2 py-1.5 text-xs text-white"
            aria-label="Reputation tier filter"
            data-testid="reputation-tier-filter"
          >
            <option value="">All tiers</option>
            {TIERS.map((tier) => (
              <option key={tier} value={tier}>
                {tier}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={() => void refreshAll()}
            disabled={refreshing || loadingReputations}
            className="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-xs text-white/90 hover:bg-white/10 disabled:opacity-50"
            data-testid="reputation-refresh"
          >
            {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          href={`/league/${encodeURIComponent(leagueId)}?tab=Hall of Fame`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/25"
        >
          <Award className="h-3.5 w-3.5" /> Hall of Fame
        </Link>
        <Link
          href={`/league/${encodeURIComponent(leagueId)}?tab=Legacy`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/25"
        >
          <TrendingUp className="h-3.5 w-3.5" /> Legacy leaderboard
        </Link>
        <Link
          href={`/league/${encodeURIComponent(leagueId)}?tab=Commissioner`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-purple-500/40 bg-purple-500/15 px-3 py-1.5 text-xs font-medium text-purple-200 hover:bg-purple-500/25"
        >
          <Shield className="h-3.5 w-3.5" /> Commissioner trust view
        </Link>
      </div>
      {trustSummary && (
        <div className="mt-3 rounded-lg border border-purple-500/20 bg-purple-500/5 p-3 text-xs text-purple-100">
          <p>
            Commissioner trust context: {trustSummary.coverage} managers tracked,{' '}
            {trustSummary.highTrust} high-trust, {trustSummary.lowTrust} low-trust.
          </p>
        </div>
      )}
      {aiPrestigeContext?.combinedHint && (
        <details className="mt-3 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3 text-xs text-cyan-100">
          <summary className="cursor-pointer font-medium">Unified prestige context for Chimmy</summary>
          <p className="mt-2">{aiPrestigeContext.combinedHint}</p>
        </details>
      )}

      {configDraft && (
        <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.03] p-3 space-y-3">
          <h4 className="text-xs font-semibold text-white/85">Reputation config (weights + tiers)</h4>
          <div className="grid gap-2 md:grid-cols-3">
            {TIERS.map((tier) => (
              <label key={tier} className="text-[11px] text-white/70">
                {tier} min
                <input
                  type="number"
                  value={configDraft.tierThresholds[tier]?.min ?? 0}
                  onChange={(e) =>
                    setConfigDraft((prev) =>
                      prev
                        ? {
                            ...prev,
                            tierThresholds: {
                              ...prev.tierThresholds,
                              [tier]: {
                                ...(prev.tierThresholds[tier] ?? { min: 0 }),
                                min: Number(e.target.value),
                              },
                            },
                          }
                        : prev
                    )
                  }
                  className="mt-1 w-full rounded bg-zinc-950 border border-zinc-800 px-2 py-1 text-xs text-white"
                />
              </label>
            ))}
          </div>
          <div className="grid gap-2 md:grid-cols-4">
            {(Object.keys(configDraft.scoreWeights) as Array<keyof ReputationConfigPayload['scoreWeights']>).map(
              (key) => (
                <label key={key} className="text-[11px] text-white/70">
                  {key}
                  <input
                    type="number"
                    step="0.05"
                    value={configDraft.scoreWeights[key]}
                    onChange={(e) =>
                      setConfigDraft((prev) =>
                        prev
                          ? {
                              ...prev,
                              scoreWeights: {
                                ...prev.scoreWeights,
                                [key]: Number(e.target.value),
                              },
                            }
                          : prev
                      )
                    }
                    className="mt-1 w-full rounded bg-zinc-950 border border-zinc-800 px-2 py-1 text-xs text-white"
                  />
                </label>
              )
            )}
          </div>
          <button
            type="button"
            onClick={() => void saveConfig()}
            disabled={savingConfig}
            className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-3 py-1.5 text-xs font-medium text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-50"
            data-testid="reputation-save-config"
          >
            {savingConfig ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Scale className="h-3.5 w-3.5" />}
            Save reputation config
          </button>
        </div>
      )}

      {reputations.length > 0 && (
        <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.03] p-3">
          <h4 className="text-xs font-semibold text-white/80 mb-2">Explain a manager</h4>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="rounded-lg bg-zinc-950 border border-zinc-800 px-2 py-1.5 text-xs text-white"
              value={selectedManagerId}
              onChange={(e) => {
                setSelectedManagerId(e.target.value)
                setExplainNarrative(null)
                setEvidenceRows([])
              }}
            >
              {reputations.map((r) => (
                <option key={r.managerId} value={r.managerId}>
                  {r.managerId} — {r.tier} ({r.overallScore.toFixed(0)}) TF {r.tradeFairnessScore.toFixed(0)}
                </option>
              ))}
            </select>
            <select
              className="rounded-lg bg-zinc-950 border border-zinc-800 px-2 py-1.5 text-xs text-white"
              value={selectedEvidenceType}
              onChange={(e) => setSelectedEvidenceType(e.target.value)}
              aria-label="Reputation evidence type filter"
            >
              <option value="">All evidence types</option>
              <option value="lineup_consistency">lineup_consistency</option>
              <option value="activity_frequency">activity_frequency</option>
              <option value="trade_fair_offers">trade_fair_offers</option>
              <option value="dispute_involved">dispute_involved</option>
              <option value="toxic_flag">toxic_flag</option>
              <option value="responsiveness">responsiveness</option>
            </select>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-2.5 py-1.5 text-xs font-medium text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-50"
              disabled={explainLoading}
              onClick={explainManager}
            >
              <BookOpen className="h-3 w-3" /> {explainLoading ? '…' : 'Explain with Chimmy'}
            </button>
            <Link
              href={`/app/league/${encodeURIComponent(leagueId)}/legacy/breakdown?entityType=MANAGER&entityId=${encodeURIComponent(selectedManagerId)}&sport=${encodeURIComponent(sportFilter)}`}
              className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/15 px-2.5 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/25"
              data-testid="reputation-legacy-breakdown-link"
            >
              <FileText className="h-3 w-3" /> Legacy breakdown
            </Link>
            <Link
              href={`/league/${encodeURIComponent(leagueId)}?tab=Trades`}
              className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-2.5 py-1.5 text-xs font-medium text-cyan-200 hover:bg-cyan-500/25"
            >
              Trade fairness context
            </Link>
          </div>
          {explainNarrative && (
            <div className="mt-2 p-2 rounded-lg bg-zinc-900/80 text-xs text-zinc-300 border border-zinc-700">
              {explainNarrative}
              {evidenceRows.length > 0 && (
                <div className="mt-2 space-y-1 text-zinc-400">
                  <p>Evidence items loaded: {evidenceRows.length}</p>
                  {evidenceRows.slice(0, 6).map((row) => (
                    <p key={row.id}>
                      {row.evidenceType}: {Math.round(row.value)} ({row.sourceReference ?? 'n/a'})
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {reputations.length > 1 && (
        <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.03] p-3">
          <h4 className="text-xs font-semibold text-white/80 mb-2">Manager comparison view</h4>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={compareAId}
              onChange={(e) => setCompareAId(e.target.value)}
              className="rounded-lg bg-zinc-950 border border-zinc-800 px-2 py-1.5 text-xs text-white"
            >
              <option value="">Manager A</option>
              {reputations.map((row) => (
                <option key={`a-${row.managerId}`} value={row.managerId}>
                  {row.managerId}
                </option>
              ))}
            </select>
            <select
              value={compareBId}
              onChange={(e) => setCompareBId(e.target.value)}
              className="rounded-lg bg-zinc-950 border border-zinc-800 px-2 py-1.5 text-xs text-white"
            >
              <option value="">Manager B</option>
              {reputations.map((row) => (
                <option key={`b-${row.managerId}`} value={row.managerId}>
                  {row.managerId}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void runComparison()}
              disabled={comparisonLoading || !compareAId || !compareBId}
              className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-3 py-1.5 text-xs font-medium text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-50"
              data-testid="reputation-compare-run"
            >
              {comparisonLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Compare'}
            </button>
          </div>
          {comparison && (
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              {[comparison.managerA, comparison.managerB].map((row, idx) => (
                <div key={idx} className="rounded border border-white/10 bg-black/30 p-2 text-xs text-white/80">
                  {row ? (
                    <>
                      <p className="font-medium text-white">{row.managerId}</p>
                      <p>{row.tier} ({row.overallScore.toFixed(0)})</p>
                      <p>Trade fairness {row.tradeFairnessScore.toFixed(0)}</p>
                      <p>Commissioner trust {row.commissionerTrustScore.toFixed(0)}</p>
                    </>
                  ) : (
                    <p>No reputation record.</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="mt-4">
        <button
          type="button"
          onClick={runEngine}
          disabled={running}
          className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-4 py-2 text-sm font-medium text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-50"
          data-testid="reputation-run-engine"
        >
          <RefreshCw className={`h-4 w-4 ${running ? 'animate-spin' : ''}`} />
          {running ? 'Running…' : 'Run reputation engine'}
        </button>
      </div>
      {error && (
        <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}
      {result && (
        <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/80">
          <p>
            Processed {result.processed} managers — {result.created} created, {result.updated} updated.
          </p>
          {result.results && result.results.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-white/60 max-h-32 overflow-y-auto">
              {result.results.slice(0, 10).map((r) => (
                <li key={r.managerId}>
                  {r.managerId}: {r.tier} ({r.overallScore.toFixed(0)})
                </li>
              ))}
              {result.results.length > 10 && (
                <li>…and {result.results.length - 10} more</li>
              )}
            </ul>
          )}
        </div>
      )}
      {loadingReputations ? (
        <p className="mt-3 text-xs text-white/50">Loading reputation cards...</p>
      ) : reputations.length > 0 ? (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {reputations.slice(0, 16).map((row) => (
            <article
              key={`${row.managerId}:${row.season}:${row.sport}`}
              className="rounded-lg border border-white/10 bg-black/30 p-2 text-xs text-white/80"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium text-white">{row.managerId}</p>
                <span className="text-cyan-300">{row.tier} {row.overallScore.toFixed(0)}</span>
              </div>
              <p className="mt-1 text-white/60">
                Reliability {row.reliabilityScore.toFixed(0)} • Activity {row.activityScore.toFixed(0)} • Trade fairness {row.tradeFairnessScore.toFixed(0)}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded border border-white/20 bg-white/5 px-2 py-1 text-[11px] text-white/80 hover:bg-white/10"
                  onClick={() => {
                    setSelectedManagerId(row.managerId)
                    setCompareAId(row.managerId)
                  }}
                >
                  Drill down
                </button>
                <button
                  type="button"
                  className="rounded border border-white/20 bg-white/5 px-2 py-1 text-[11px] text-white/80 hover:bg-white/10"
                  onClick={() => setCompareBId(row.managerId)}
                >
                  Set compare target
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-xs text-white/55">No reputation records for this filter scope.</p>
      )}
    </section>
  )
}
