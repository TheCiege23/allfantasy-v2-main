'use client'

import { useCallback, useRef, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { SimulationResultCard } from '@/components/ai/sim/SimulationResultCard'
import type { FranchiseSimResult, SeasonSimResult, TradeSimResult } from '@/lib/ai/sim/types'

type SimKind = 'season' | 'franchise' | 'draft' | 'trade'

export function SimulationPanel({
  title = 'Simulation',
  description,
  requestBody,
  tradeFocusTeamId,
  onResult,
  className = '',
}: {
  title?: string
  description?: string
  requestBody: Record<string, unknown>
  /** When `requestBody.kind === 'trade'`, show deltas for this team id. */
  tradeFocusTeamId?: string
  onResult?: (r: unknown) => void
  className?: string
}) {
  const bodyRef = useRef(requestBody)
  bodyRef.current = requestBody

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [season, setSeason] = useState<SeasonSimResult | null>(null)
  const [franchise, setFranchise] = useState<FranchiseSimResult | null>(null)
  const [trade, setTrade] = useState<TradeSimResult | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setLoading(false)
  }, [])

  const run = useCallback(async () => {
    setLoading(true)
    setError(null)
    setSeason(null)
    setFranchise(null)
    setTrade(null)
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    try {
      const body = bodyRef.current
      const res = await fetch('/api/ai/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ac.signal,
      })
      const json = (await res.json()) as { ok?: boolean; result?: unknown; error?: string }
      if (!res.ok || !json.ok) {
        setError(json.error || 'Simulation failed')
        return
      }
      onResult?.(json.result)
      const kind = body.kind as SimKind
      if (kind === 'season' && json.result && typeof json.result === 'object' && 'championshipOdds' in (json.result as object)) {
        setSeason(json.result as SeasonSimResult)
      }
      if (kind === 'franchise' && json.result && typeof json.result === 'object' && 'years' in (json.result as object)) {
        setFranchise(json.result as FranchiseSimResult)
      }
      if (kind === 'trade' && json.result && typeof json.result === 'object' && 'winDelta' in (json.result as object)) {
        setTrade(json.result as TradeSimResult)
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      setError('Network error')
    } finally {
      setLoading(false)
      abortRef.current = null
    }
  }, [onResult])

  return (
    <div className={`rounded-xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/[0.06] to-transparent p-4 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-white">{title}</h3>
          {description ? <p className="mt-1 text-[12px] text-white/55">{description}</p> : null}
        </div>
        <div className="flex gap-2">
          {loading ? (
            <button
              type="button"
              onClick={() => cancel()}
              className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-3 py-1.5 text-[11px] text-white/80"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
              Cancel
            </button>
          ) : null}
          <button
            type="button"
            disabled={loading}
            onClick={() => void run()}
            className="inline-flex items-center gap-2 rounded-lg bg-cyan-500/90 px-4 py-2 text-[12px] font-bold text-black disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Run simulation
          </button>
        </div>
      </div>
      {error ? <p className="mt-2 text-[12px] text-rose-300">{error}</p> : null}
      {season ? (
        <div className="mt-4">
          <SimulationResultCard
            title="Season outlook"
            championshipOdds={season.championshipOdds}
            playoffOdds={season.playoffOdds}
            avgWins={season.avgWins}
            iterations={season.iterations}
            weeksSimulated={season.weeksSimulated}
          />
        </div>
      ) : null}
      {franchise ? (
        <div className="mt-4 space-y-2 text-[12px] text-white/75">
          {franchise.years.map((y) => (
            <div key={y.year} className="flex justify-between rounded-lg border border-white/10 bg-black/30 px-3 py-2">
              <span>Year {y.year}</span>
              <span>
                Playoff {(y.playoffOdds * 100).toFixed(0)}% · Title {(y.championshipOdds * 100).toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {trade && tradeFocusTeamId ? (
        <div className="mt-4 rounded-lg border border-white/10 bg-black/25 px-3 py-3 text-[12px] text-white/80">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45">Trade impact estimate (sender)</div>
          <div className="mt-2 grid grid-cols-2 gap-2 tabular-nums">
            <div>
              Δ Avg wins <span className="text-cyan-200/90">{(trade.winDelta[tradeFocusTeamId] ?? 0).toFixed(2)}</span>
            </div>
            <div>
              Δ Playoff odds (est.){' '}
              <span className="text-cyan-200/90">{((trade.playoffDelta[tradeFocusTeamId] ?? 0) * 100).toFixed(1)} pts</span>
            </div>
            <div>
              Δ Title odds (est.){' '}
              <span className="text-cyan-200/90">{((trade.championshipDelta[tradeFocusTeamId] ?? 0) * 100).toFixed(2)} pts</span>
            </div>
            <div>
              Δ Risk (spread){' '}
              <span className="text-cyan-200/90">{(trade.riskChange[tradeFocusTeamId] ?? 0).toFixed(2)}</span>
            </div>
          </div>
          <p className="mt-2 text-[10px] text-white/40">
            Estimates from a simulation seeded with placeholder projections — listed trade assets only, synthetic bench padding.
            Directional insight, not real playoff or title odds.
          </p>
        </div>
      ) : null}
    </div>
  )
}
