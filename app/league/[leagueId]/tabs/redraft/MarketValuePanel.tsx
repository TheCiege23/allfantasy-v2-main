'use client'

import { useCallback, useEffect, useState } from 'react'
import { fetchAllFantasyMarketValues, type AllFantasyMarketValueRow } from '@/lib/redraft/client'

/**
 * T9 commissioner-only "AllFantasy Market Value" panel — read-only. Shows published official market
 * values (separate from provider/ADP/projection/snapshot values) or an insufficient-history message.
 * Does NOT change trade grading and changes no other value.
 */
export function MarketValuePanel({ leagueId }: { leagueId: string }) {
  const [open, setOpen] = useState(false)
  const [values, setValues] = useState<AllFantasyMarketValueRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setValues((await fetchAllFantasyMarketValues(leagueId)).values)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load market values')
    } finally {
      setLoading(false)
    }
  }, [leagueId])

  useEffect(() => {
    if (open && values === null && !loading) void load()
  }, [open, values, loading, load])

  return (
    <div className="rounded-lg border border-amber-300/15 bg-amber-400/[0.05]" data-testid="market-value-panel">
      <button
        type="button"
        data-testid="market-value-toggle"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-1.5 text-[11px] font-semibold text-amber-100"
      >
        <span>AllFantasy Market Value</span>
        <span className="text-amber-200/70">{open ? '▾' : '▸'}</span>
      </button>

      {open ? (
        <div className="space-y-2 border-t border-amber-300/15 px-3 py-2 text-[11px]">
          {loading ? (
            <p className="text-white/50">Loading…</p>
          ) : error ? (
            <p className="text-rose-300">{error}</p>
          ) : values && values.length ? (
            <>
              <div className="space-y-1">
                {values.slice(0, 10).map((v) => (
                  <div key={v.playerId} className="flex items-center justify-between gap-2 text-[10px] text-white/70">
                    <span className="truncate">{v.playerName ?? v.playerId}{v.position ? ` · ${v.position}` : ''}</span>
                    <span>
                      <span className="text-white/50">{v.baseValue}→</span>
                      <span className="font-semibold text-white">{v.marketValue}</span>
                      <span className={v.direction === 'rising' ? 'ml-1 text-emerald-300' : v.direction === 'falling' ? 'ml-1 text-rose-300' : 'ml-1 text-white/50'}>
                        {v.adjustmentPercent > 0 ? '+' : ''}{v.adjustmentPercent}%
                      </span>
                      <span className="ml-1 text-white/40">c{v.confidence}/n{v.sampleSize}</span>
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[9px] text-white/35" data-testid="market-value-disclaimer">
                AllFantasy market value is separate from provider, ADP, projection, and historical snapshot values.
              </p>
            </>
          ) : (
            <p className="text-white/55" data-testid="market-value-insufficient">
              Not enough verified AllFantasy market history to publish an official market value yet.
            </p>
          )}
        </div>
      ) : null}
    </div>
  )
}
