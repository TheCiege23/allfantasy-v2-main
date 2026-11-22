'use client'

import { useState } from 'react'
import { VIZ } from '@/components/partners/vizTokens'
import { tradeMarketSentence, tradeMarketView, type TradeMarketRow } from '@/lib/partner-portal/demoTenant'

/**
 * What managers actually pay in trades, against the standard value chart: one bar per measured situation, growing
 * right of the centre line when managers paid MORE than the chart and left when they paid less. Two hues for the two
 * directions with the neutral centre line between them; the signed number is always printed beside the row in text
 * ink, so direction never rests on colour alone. A row without enough completed trades is drawn as a dashed empty
 * track and says so — it is not hidden and not guessed.
 */
const MORE = VIZ.series1
const LESS = VIZ.series2

const signed = (pct: number) => `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct)}%`

export function TradeMarketBars({ rows }: { rows: readonly TradeMarketRow[] }) {
  const [hover, setHover] = useState<string | null>(null)
  const view = tradeMarketView(rows)

  return (
    <div>
      <ul className="mb-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-white/65" aria-label="Legend">
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: MORE }} aria-hidden />
          Paid more than the chart
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: LESS }} aria-hidden />
          Paid less than the chart
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-4 rounded-sm border border-dashed border-white/35" aria-hidden />
          Not enough trades yet
        </li>
      </ul>

      <div className="space-y-6">
        {view.groups.map((g) => (
          <section key={g.group} aria-label={g.group}>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/45">{g.group}</h3>
            <ul className="space-y-3">
              {g.rows.map((r) => {
                const pct = r.premiumPct
                const width = pct == null ? 0 : Math.min(50, (Math.abs(pct) / view.scalePct) * 50)
                const active = hover === r.label
                return (
                  <li key={r.label}>
                    <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                      <span className="min-w-0 text-white/85">{r.label}</span>
                      <span className="text-xs text-white/55">
                        {pct == null ? (
                          <>
                            {r.trades} of {r.needed ?? 20} trades needed
                          </>
                        ) : (
                          <>
                            <span className="text-sm font-semibold tabular-nums text-white">{signed(pct)}</span> · {r.trades.toLocaleString()} trades
                          </>
                        )}
                      </span>
                    </div>
                    <div
                      tabIndex={0}
                      role="img"
                      aria-label={tradeMarketSentence(r)}
                      className="relative h-4 w-full rounded outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                      style={{ background: pct == null ? 'transparent' : 'rgba(255,255,255,0.04)' }}
                      onMouseEnter={() => setHover(r.label)}
                      onMouseLeave={() => setHover(null)}
                      onFocus={() => setHover(r.label)}
                      onBlur={() => setHover(null)}
                    >
                      {pct == null ? (
                        <span className="absolute inset-0 rounded border border-dashed border-white/25" aria-hidden />
                      ) : pct !== 0 ? (
                        <span
                          aria-hidden
                          className="absolute top-0 h-full"
                          style={{
                            width: `${width}%`,
                            ...(pct > 0 ? { left: '50%', borderRadius: '0 4px 4px 0' } : { right: '50%', borderRadius: '4px 0 0 4px' }),
                            background: pct > 0 ? MORE : LESS,
                            opacity: hover && !active ? 0.55 : 1,
                          }}
                        />
                      ) : null}
                      {/* The standard chart: the neutral centre line every bar is measured from. */}
                      <span className="absolute left-1/2 top-[-3px] h-[22px] w-px" style={{ background: VIZ.axis }} aria-hidden />
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>

      <div className="mt-2 flex justify-between text-[11px] tabular-nums text-white/45" aria-hidden>
        <span>−{view.scalePct}%</span>
        <span>Standard chart</span>
        <span>+{view.scalePct}%</span>
      </div>

      {/* The hover / focus readout has its own line, so it never covers a row. */}
      <p className="mt-3 min-h-[2.5rem] text-xs text-white/65" role="status">
        {hover
          ? tradeMarketSentence(rows.find((r) => r.label === hover)!)
          : `${view.published} of ${rows.length} situations have enough completed trades to publish a number (${view.tradesBehindPublished.toLocaleString()} trades behind them). The rest stay on the standard chart until they do.`}
      </p>

      <details className="mt-2 text-xs text-white/60">
        <summary className="cursor-pointer select-none">View as table</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[440px] text-left">
            <thead>
              <tr className="text-white/45">
                <th className="py-1 font-medium">Situation</th>
                <th className="py-1 text-right font-medium">Against the chart</th>
                <th className="py-1 text-right font-medium">Completed trades</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-t border-white/5">
                  <td className="py-1">
                    {r.group}: {r.label}
                  </td>
                  <td className="py-1 text-right tabular-nums">{r.premiumPct == null ? 'Not enough trades yet' : signed(r.premiumPct)}</td>
                  <td className="py-1 text-right tabular-nums">{r.trades.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
