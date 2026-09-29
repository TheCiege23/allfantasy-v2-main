'use client'

import { useCallback, useEffect, useState } from 'react'
import { fetchTradeMarketAggregates, fetchAdaptiveValueTopMovers, type TradeMarketAggregates, type AdaptiveValuePreview } from '@/lib/redraft/client'

/**
 * T5 commissioner-only "Market Snapshot" — read-only AllFantasy trade-market aggregates. No player
 * values, no price movement, no recommendations. Shows "Not enough AllFantasy market history yet"
 * under the minimum sample. Collapsed by default.
 */
export function MarketSnapshotPanel({ leagueId }: { leagueId: string }) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<TradeMarketAggregates | null>(null)
  const [movers, setMovers] = useState<AdaptiveValuePreview[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [agg, mv] = await Promise.all([
        fetchTradeMarketAggregates({ leagueId, scope: 'league' }),
        fetchAdaptiveValueTopMovers(leagueId).catch(() => ({ topMovers: [] as AdaptiveValuePreview[] })),
      ])
      setData(agg)
      setMovers(mv.topMovers)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load market snapshot')
    } finally {
      setLoading(false)
    }
  }, [leagueId])

  useEffect(() => {
    if (open && !data && !loading) void load()
  }, [open, data, loading, load])

  const s = data?.summary
  const g = data?.gradeDistribution

  return (
    <div className="rounded-lg border border-emerald-300/15 bg-emerald-400/[0.05]" data-testid="market-snapshot-panel">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid="market-snapshot-toggle"
        className="flex w-full items-center justify-between px-3 py-1.5 text-[11px] font-semibold text-emerald-100"
      >
        <span>AllFantasy Market Snapshot</span>
        <span className="text-emerald-200/70">{open ? '▾' : '▸'}</span>
      </button>

      {open ? (
        <div className="space-y-2 border-t border-emerald-300/15 px-3 py-2 text-[11px]">
          {loading ? (
            <p className="text-white/50">Loading…</p>
          ) : error ? (
            <p className="text-rose-300">{error}</p>
          ) : data && s ? (
            data.sampleStatus === 'empty' || data.sampleStatus === 'insufficient' ? (
              <p className="text-white/55" data-testid="market-snapshot-insufficient">
                Not enough AllFantasy market history yet{s.sampleSize ? ` (${s.sampleSize} so far)` : ''}.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2 text-[11px] text-white/70">
                  <span className="rounded border border-white/15 px-2 py-0.5">Sample {s.sampleSize}</span>
                  <span className="rounded border border-white/15 px-2 py-0.5">Accepted {s.acceptedCount}</span>
                  <span className="rounded border border-white/15 px-2 py-0.5">Vetoed {s.vetoedCount}</span>
                  <span className="rounded border border-white/15 px-2 py-0.5">Rejected {s.rejectedCount}</span>
                </div>
                <div className="flex flex-wrap gap-2 text-[11px] text-white/60">
                  <span>Avg fairness {s.averageFairness ?? '—'}</span>
                  <span>Median fairness {s.medianFairness ?? '—'}</span>
                  <span>Avg confidence {s.averageConfidence ?? '—'}</span>
                </div>
                {g ? (
                  <p className="text-[11px] text-white/55">
                    Grades — A {g.aRange} · B {g.bRange} · C {g.cRange} · D/F {g.dfRange} · ? {g.unknown}
                  </p>
                ) : null}
                <p className="text-[11px] text-white/35">Read-only market history. Does not change player values.</p>

                <div className="mt-1 border-t border-white/10 pt-1.5" data-testid="adaptive-preview-section">
                  <p className="text-[11px] font-semibold text-white/70">AllFantasy Market Preview — top movers</p>
                  {movers && movers.length ? (
                    <ul className="mt-0.5 space-y-0.5 text-[11px] text-white/60">
                      {movers.slice(0, 5).map((m) => (
                        <li key={m.playerId} className="flex justify-between gap-2">
                          <span className="truncate">{m.playerName ?? m.playerId}{m.position ? ` · ${m.position}` : ''}</span>
                          <span className={m.direction === 'rising' ? 'text-emerald-300' : m.direction === 'falling' ? 'text-rose-300' : 'text-white/50'}>
                            {m.adjustmentPercent > 0 ? '+' : ''}{m.adjustmentPercent}% ({m.direction})
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-0.5 text-[11px] text-white/45">Not enough AllFantasy trade history yet to adjust players.</p>
                  )}
                  <p className="text-[11px] text-white/35">Preview only. Does not change official player value.</p>
                </div>
              </>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
