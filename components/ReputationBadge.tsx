'use client'

import { useState, useEffect } from 'react'

interface ReputationData {
  tier: string
  overallScore: number
  tradeFairnessScore?: number
  sport?: string
  season?: number
  tierBadgeColor: string
}

/**
 * Fetches and displays manager reputation tier (e.g. "Trusted 72") for a given league + manager.
 * Use in member lists, trade finder, commissioner views.
 */
export function ReputationBadge({
  leagueId,
  managerId,
  sport,
  season,
  showScore = true,
  showTradeFairness = false,
  className = '',
}: {
  leagueId: string
  managerId: string
  sport?: string
  season?: number
  showScore?: boolean
  showTradeFairness?: boolean
  className?: string
}) {
  const [rep, setRep] = useState<ReputationData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!leagueId || !managerId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ managerId })
    if (sport) params.set('sport', sport)
    if (typeof season === 'number' && Number.isFinite(season)) params.set('season', String(season))
    const url = `/api/leagues/${encodeURIComponent(leagueId)}/reputation?${params.toString()}`
    fetch(url, { cache: 'no-store' })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(data?.error || 'Failed to load reputation')
        return data
      })
      .then((data) => {
        if (data?.reputation) setRep(data.reputation)
        else setRep(null)
      })
      .catch((e) => {
        setRep(null)
        setError(e instanceof Error ? e.message : 'Failed to load reputation')
      })
      .finally(() => setLoading(false))
  }, [leagueId, managerId, sport, season])

  if (loading) {
    return (
      <span className={`inline-block h-4 w-14 animate-pulse rounded bg-white/10 ${className}`} title="Loading reputation…" />
    )
  }
  if (!rep) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded border border-white/20 bg-white/5 px-1.5 py-0.5 text-[11px] font-medium text-white/60 ${className}`}
        title={error ? `Reputation unavailable: ${error}` : 'Reputation not generated yet'}
      >
        No rep
      </span>
    )
  }

  const colorClass =
    rep.tierBadgeColor === 'amber'
      ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
      : rep.tierBadgeColor === 'emerald'
        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
        : rep.tierBadgeColor === 'green'
          ? 'border-green-500/30 bg-green-500/10 text-green-200'
          : rep.tierBadgeColor === 'blue'
            ? 'border-blue-500/30 bg-blue-500/10 text-blue-200'
            : rep.tierBadgeColor === 'red'
              ? 'border-red-500/30 bg-red-500/10 text-red-200'
              : 'border-white/20 bg-white/5 text-white/70'

  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium ${colorClass} ${className}`}
      title={`Reputation: ${rep.tier} (${rep.overallScore.toFixed(0)}/100)${
        typeof rep.tradeFairnessScore === 'number'
          ? `, Trade fairness ${rep.tradeFairnessScore.toFixed(0)}`
          : ''
      }`}
    >
      <span>{rep.tier}</span>
      {showScore && <span className="opacity-80">{rep.overallScore.toFixed(0)}</span>}
      {showTradeFairness && typeof rep.tradeFairnessScore === 'number' && (
        <span className="opacity-80">TF {rep.tradeFairnessScore.toFixed(0)}</span>
      )}
    </span>
  )
}
