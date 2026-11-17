'use client'

import { useState } from 'react'
import { VIZ } from '@/components/partners/vizTokens'
import { decisionShares, type DecisionRow } from '@/lib/partner-portal/demoTenant'

const PARTS = [
  { key: 'acted', label: 'Acted on', color: VIZ.series1 },
  { key: 'dismissed', label: 'Dismissed', color: VIZ.series2 },
  { key: 'none', label: 'No response', color: VIZ.neutral },
] as const

/**
 * What happened to each kind of recommendation: a 100% bar per kind (part-to-whole), three parts with a
 * 2px surface gap, a legend (three series) plus a direct label on the part that matters (acted on), and the
 * outcome — "helped when acted on" — as text beside it, not as a fourth colour.
 */
export function DecisionBars({ rows }: { rows: readonly DecisionRow[] }) {
  const [hover, setHover] = useState<{ row: number; part: number } | null>(null)

  return (
    <div>
      <ul className="mb-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-white/65" aria-label="Legend">
        {PARTS.map((p) => (
          <li key={p.key} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} aria-hidden />
            {p.label}
          </li>
        ))}
      </ul>
      <div className="space-y-5">
        {rows.map((r, ri) => {
          const s = decisionShares(r)
          const widths = [s.actedPct, s.dismissedPct, s.noResponsePct]
          const counts = [r.actedOn, r.dismissed, Math.max(0, r.shown - r.actedOn - r.dismissed)]
          return (
            <div key={r.kind}>
              <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                <span className="font-semibold text-white">{r.kind}</span>
                {/* The hover readout takes this slot, so it never covers the row's own name. */}
                {hover?.row === ri ? (
                  <span className="text-xs" role="status">
                    <span className="text-white/60">{PARTS[hover.part]!.label}: </span>
                    <span className="font-semibold text-white">
                      {counts[hover.part]!.toLocaleString()} ({widths[hover.part]}%)
                    </span>
                  </span>
                ) : (
                  <span className="text-xs text-white/55">{r.shown.toLocaleString()} shown</span>
                )}
              </div>
              <div className="relative">
                <div className="flex h-6 w-full gap-[2px] overflow-hidden rounded" role="img" aria-label={`${r.kind}: acted on ${s.actedPct}%, dismissed ${s.dismissedPct}%, no response ${s.noResponsePct}%`}>
                  {widths.map((w, pi) =>
                    w > 0 ? (
                      <div
                        key={PARTS[pi]!.key}
                        tabIndex={0}
                        className="h-full outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                        style={{
                          width: `${w}%`,
                          background: PARTS[pi]!.color,
                          opacity: hover?.row === ri && hover.part !== pi ? 0.55 : 1,
                        }}
                        onMouseEnter={() => setHover({ row: ri, part: pi })}
                        onMouseLeave={() => setHover(null)}
                        onFocus={() => setHover({ row: ri, part: pi })}
                        onBlur={() => setHover(null)}
                        aria-label={`${PARTS[pi]!.label}: ${counts[pi]!.toLocaleString()} (${w}%)`}
                      >
                        {pi === 0 && w >= 12 ? (
                          <span className="flex h-full items-center pl-2 text-xs font-semibold text-white">{w}%</span>
                        ) : null}
                      </div>
                    ) : null,
                  )}
                </div>
              </div>
              <p className="mt-1.5 text-xs text-white/60">
                {s.helpedPct == null ? (
                  'No outcomes measured yet.'
                ) : (
                  <>
                    <span className="font-semibold text-white">Helped {s.helpedPct}%</span> of the {r.measured.toLocaleString()} measured so far — {r.helpedMeans}.
                  </>
                )}
              </p>
            </div>
          )
        })}
      </div>
      <details className="mt-4 text-xs text-white/60">
        <summary className="cursor-pointer select-none">View as table</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[520px] text-left">
            <thead>
              <tr className="text-white/45">
                <th className="py-1 font-medium">Recommendation</th>
                <th className="py-1 text-right font-medium">Shown</th>
                <th className="py-1 text-right font-medium">Acted on</th>
                <th className="py-1 text-right font-medium">Dismissed</th>
                <th className="py-1 text-right font-medium">Measured</th>
                <th className="py-1 text-right font-medium">Helped</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.kind} className="border-t border-white/5">
                  <td className="py-1">{r.kind}</td>
                  <td className="py-1 text-right tabular-nums">{r.shown.toLocaleString()}</td>
                  <td className="py-1 text-right tabular-nums">{r.actedOn.toLocaleString()}</td>
                  <td className="py-1 text-right tabular-nums">{r.dismissed.toLocaleString()}</td>
                  <td className="py-1 text-right tabular-nums">{r.measured.toLocaleString()}</td>
                  <td className="py-1 text-right tabular-nums">{r.helped.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
