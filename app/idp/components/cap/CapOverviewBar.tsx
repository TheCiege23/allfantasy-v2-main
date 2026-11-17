'use client'

import type { CapAdvice } from '@/lib/idp/ai/idpCapChimmy'

type Props = {
  activeSalary: number
  deadMoney: number
  availableCap: number
  totalCap: number
  year: number
  onYearChange?: (y: number) => void
  yearOptions?: number[]
  /** AfSub: AI cap recommendations */
  capAdvice?: CapAdvice | null
  capAdviceLoading?: boolean
  onOpenFullCapAnalysis?: () => void
}

export function CapOverviewBar({
  activeSalary,
  deadMoney,
  availableCap,
  totalCap,
  year,
  onYearChange,
  yearOptions,
  capAdvice,
  capAdviceLoading,
  onOpenFullCapAnalysis,
}: Props) {
  const t = Math.max(totalCap, 0.001)
  const a = Math.max(0, activeSalary)
  const d = Math.max(0, deadMoney)
  const v = Math.max(0, availableCap)
  const sum = a + d + v
  const scale = sum > 0 ? sum : t
  const pActive = scale > 0 ? (a / scale) * 100 : 0
  const pDead = scale > 0 ? (d / scale) * 100 : 0
  const pAvail = Math.max(0, 100 - pActive - pDead)

  const years = yearOptions ?? [year, year + 1, year + 2, year + 3]

  return (
    <div className="space-y-3" data-testid="cap-overview-bar">
      {onYearChange ? (
        <div className="flex flex-wrap gap-1 border-b border-white/[0.06] pb-2">
          {years.map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => onYearChange(y)}
              className={`rounded-lg px-3 py-1.5 text-[11px] font-bold ${
                y === year ? 'bg-sky-500/20 text-sky-100' : 'text-white/45 hover:bg-white/[0.04]'
              }`}
            >
              {y}
            </button>
          ))}
        </div>
      ) : null}
      <div
        className="flex h-4 w-full overflow-hidden rounded-full"
        style={{ background: 'var(--cap-bar-bg)' }}
      >
        <div
          className="h-full bg-[color:var(--cap-contract)] transition-all"
          style={{ width: `${pActive}%` }}
          title="Active salary"
        />
        <div
          className="h-full bg-[color:var(--cap-dead)] transition-all"
          style={{ width: `${pDead}%` }}
          title="Dead money"
        />
        <div
          className="h-full bg-cap-green/90 transition-all"
          style={{ width: `${pAvail}%` }}
          title="Available"
        />
      </div>
      <div className="flex flex-wrap gap-2 text-[11px]">
        <span className="rounded-full border border-cap-contract/30 bg-cap-contract/10 px-2 py-1 font-semibold text-blue-100">
          Active: ${a.toFixed(1)}M
        </span>
        <span className="rounded-full border border-cap-dead/30 bg-white/[0.04] px-2 py-1 font-semibold text-white/60">
          Dead: ${d.toFixed(1)}M
        </span>
        <span className="rounded-full border border-cap-green/30 bg-cap-green/10 px-2 py-1 font-semibold text-emerald-100">
          Available: ${v.toFixed(1)}M
        </span>
      </div>

      {capAdviceLoading ? (
        <p className="text-[11px] text-white/40">Loading AI cap tips…</p>
      ) : capAdvice?.recommendations?.length ? (
        <div className="rounded-xl border border-cyan-500/25 bg-cyan-950/15 p-3" data-testid="cap-overview-ai-moves">
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-cyan-200/90">Best cap moves</h3>
          <ul className="mt-2 space-y-2 text-[12px] text-white/85">
            {capAdvice.recommendations.slice(0, 3).map((r, i) => (
              <li key={i}>
                <span className="font-semibold text-cyan-100/95">{r.action}</span>
                {r.player ? ` · ${r.player}` : ''} — {r.savingsOrCost}. {r.reason}
              </li>
            ))}
          </ul>
          {capAdvice.summary ? (
            <p className="mt-2 text-[11px] text-white/50">{capAdvice.summary}</p>
          ) : null}
          {onOpenFullCapAnalysis ? (
            <button
              type="button"
              onClick={onOpenFullCapAnalysis}
              className="mt-3 rounded-lg border border-cyan-500/40 px-3 py-2 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-950/40"
            >
              See Full AI Cap Analysis
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
