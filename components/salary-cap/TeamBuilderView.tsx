'use client'

import { formatCapMoney } from '@/lib/salary-cap/capMoney'
import { Users, ArrowLeft, TrendingUp } from 'lucide-react'
import type { SalaryCapSummary } from './types'

export function TeamBuilderView({
  summary,
  leagueId,
  onBack,
}: {
  summary: SalaryCapSummary
  leagueId: string
  /** Absent inside the league workspace, whose sidebar already navigates (SalaryCapHome `shellNav`). */
  onBack?: () => void
}) {
  const ledger = summary.ledger
  const config = summary.config
  const isBestBall = config.mode === 'bestball'

  const byPosition = summary.contracts.reduce<Record<string, number>>((acc, c) => {
    const pos = c.position ?? 'Other'
    acc[pos] = (acc[pos] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="space-y-6">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm text-white/70 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
      ) : null}

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
          <Users className="h-5 w-5 text-emerald-400" />
          Team Builder {isBestBall && '(Best Ball)'}
        </h2>

        {isBestBall && (
          <div className="mb-4 rounded-xl border border-cyan-500/30 bg-cyan-950/20 p-3">
            <p className="flex items-center gap-2 text-sm text-cyan-200">
              <TrendingUp className="h-4 w-4" />
              Best Ball: lineup is optimized automatically from your roster each week.
            </p>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <p className="text-xs text-white/50">Roster size</p>
            <p className="text-xl font-semibold text-white/90">{summary.contracts.length} players</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 p-4">
            <p className="text-xs text-white/50">Cap space</p>
            <p className="text-xl font-semibold text-emerald-300">
              {ledger ? formatCapMoney(ledger.capSpace) : '—'}
            </p>
          </div>
        </div>

        <h3 className="mt-6 mb-2 text-sm font-medium text-white/80">Position / cap balance</h3>
        <ul className="space-y-2">
          {Object.entries(byPosition).map(([pos, count]) => (
            <li
              key={pos}
              className="flex items-center justify-between rounded-lg border border-white/5 bg-black/20 px-3 py-2 text-sm"
            >
              <span className="text-white/80">{pos}</span>
              <span className="tabular-nums text-white/70">{count} {count === 1 ? 'contract' : 'contracts'}</span>
            </li>
          ))}
        </ul>

        <p className="mt-4 text-xs text-white/50">
          Long-term risk: high salary + long term = less flexibility. Rookie contracts and
          short-term deals improve future cap health.
        </p>
      </section>
    </div>
  )
}
