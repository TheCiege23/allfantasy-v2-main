'use client'

import { useCallback, useEffect, useState } from 'react'
import { fetchTradeMarketAggregates, fetchAdaptiveValueTopMovers, type TradeMarketAggregates, type AdaptiveValuePreview } from '@/lib/redraft/client'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { tOr } from '@/lib/i18n/tInterpolate'

/**
 * T5 commissioner-only "Market Snapshot" — read-only AllFantasy trade-market aggregates. No player
 * values, no price movement, no recommendations. Shows "Not enough AllFantasy market history yet"
 * under the minimum sample. Collapsed by default.
 */
export function MarketSnapshotPanel({ leagueId }: { leagueId: string }) {
  const { t, tInterpolate } = useOptionalLanguage()
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
      setError(e instanceof Error ? e.message : t('tradeCenter.snapshot.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [leagueId, t])

  useEffect(() => {
    // `error === null`: a failed load stays failed instead of re-fetching on every render.
    if (open && !data && !loading && error === null) void load()
  }, [open, data, loading, error, load])

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
        <span>{t('tradeCenter.snapshot.toggle')}</span>
        <span className="text-emerald-200/70">{open ? '▾' : '▸'}</span>
      </button>

      {open ? (
        <div className="space-y-2 border-t border-emerald-300/15 px-3 py-2 text-[11px]">
          {loading ? (
            <p className="text-white/50">{t('tradeCenter.snapshot.loading')}</p>
          ) : error ? (
            <p className="text-rose-300">{error}</p>
          ) : data && s ? (
            data.sampleStatus === 'empty' || data.sampleStatus === 'insufficient' ? (
              <p className="text-white/55" data-testid="market-snapshot-insufficient">
                {s.sampleSize
                  ? tInterpolate('tradeCenter.snapshot.insufficientSoFar', { count: s.sampleSize })
                  : t('tradeCenter.snapshot.insufficient')}
              </p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2 text-[11px] text-white/70">
                  <span className="rounded border border-white/15 px-2 py-0.5">{tInterpolate('tradeCenter.snapshot.sample', { count: s.sampleSize })}</span>
                  <span className="rounded border border-white/15 px-2 py-0.5">{tInterpolate('tradeCenter.snapshot.accepted', { count: s.acceptedCount })}</span>
                  <span className="rounded border border-white/15 px-2 py-0.5">{tInterpolate('tradeCenter.snapshot.vetoed', { count: s.vetoedCount })}</span>
                  <span className="rounded border border-white/15 px-2 py-0.5">{tInterpolate('tradeCenter.snapshot.rejected', { count: s.rejectedCount })}</span>
                </div>
                <div className="flex flex-wrap gap-2 text-[11px] text-white/60">
                  <span>{tInterpolate('tradeCenter.snapshot.avgFairness', { value: s.averageFairness ?? '—' })}</span>
                  <span>{tInterpolate('tradeCenter.snapshot.medianFairness', { value: s.medianFairness ?? '—' })}</span>
                  <span>{tInterpolate('tradeCenter.snapshot.avgConfidence', { value: s.averageConfidence ?? '—' })}</span>
                </div>
                {g ? (
                  <p className="text-[11px] text-white/55">
                    {tInterpolate('tradeCenter.snapshot.grades', { a: g.aRange, b: g.bRange, c: g.cRange, df: g.dfRange, unknown: g.unknown })}
                  </p>
                ) : null}
                <p className="text-[11px] text-white/35">{t('tradeCenter.snapshot.readOnly')}</p>

                <div className="mt-1 border-t border-white/10 pt-1.5" data-testid="adaptive-preview-section">
                  <p className="text-[11px] font-semibold text-white/70">{t('tradeCenter.snapshot.previewTitle')}</p>
                  {movers && movers.length ? (
                    <ul className="mt-0.5 space-y-0.5 text-[11px] text-white/60">
                      {movers.slice(0, 5).map((m) => (
                        <li key={m.playerId} className="flex justify-between gap-2">
                          <span className="truncate">{m.playerName ?? m.playerId}{m.position ? ` · ${m.position}` : ''}</span>
                          <span className={m.direction === 'rising' ? 'text-emerald-300' : m.direction === 'falling' ? 'text-rose-300' : 'text-white/50'}>
                            {m.adjustmentPercent > 0 ? '+' : ''}{m.adjustmentPercent}% ({tOr(t, `tradeCenter.snapshot.direction.${m.direction}`, m.direction)})
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-0.5 text-[11px] text-white/45">{t('tradeCenter.snapshot.noMovers')}</p>
                  )}
                  <p className="text-[11px] text-white/35">{t('tradeCenter.snapshot.previewOnly')}</p>
                </div>
              </>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
