'use client'

import { formatCapMoney, isOverCap } from '@/lib/salary-cap/capMoney'
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

  /** Contracts and salary per position (2026-11-23: it was a count only, so "cap balance" showed no money). */
  const byPosition = summary.contracts.reduce<Record<string, { count: number; salary: number }>>((acc, c) => {
    const pos = c.position ?? 'Other'
    const row = (acc[pos] ??= { count: 0, salary: 0 })
    row.count += 1
    row.salary += c.salary
    return acc
  }, {})
  const over = isOverCap(ledger?.capSpace)
  const cap = summary.config.startupCap + (ledger?.rolloverUsed ?? 0)

  return (
    <div className="space-y-6">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm text-[var(--text2)] hover:text-[var(--text)]"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
      ) : null}

      <section className="rounded-2xl border border-[var(--line)] bg-white/[0.03] p-4 sm:p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-[var(--text)]">
          <Users className="h-5 w-5 text-[var(--good)]" />
          Team Builder {isBestBall && '(Best Ball)'}
        </h2>

        {isBestBall && (
          <div className="mb-4 rounded-xl border border-[var(--accent-line)] bg-[var(--accent-soft)] p-3">
            <p className="flex items-center gap-2 text-sm text-[var(--accent)]">
              <TrendingUp className="h-4 w-4" />
              Best Ball: lineup is optimized automatically from your roster each week.
            </p>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-[var(--line)] bg-[var(--surface2)] p-4">
            <p className="text-xs text-[var(--muted)]">Under contract</p>
            <p className="text-xl font-semibold text-[var(--text)]">{summary.contracts.length} {summary.contracts.length === 1 ? 'player' : 'players'}</p>
          </div>
          <div className="rounded-xl border border-[var(--line)] bg-[var(--surface2)] p-4">
            <p className="text-xs text-[var(--muted)]">{over ? 'Over the cap by' : 'Cap space'}</p>
            {/* Over the cap it read "−$12" in green with no warning (2026-11-23). */}
            <p className={`text-xl font-semibold ${over ? 'text-[var(--bad)]' : 'text-[var(--good)]'}`} data-testid="salary-cap-builder-space">
              {ledger ? (over ? formatCapMoney(-ledger.capSpace) : formatCapMoney(ledger.capSpace)) : '—'}
            </p>
          </div>
        </div>

        <h3 className="mt-6 mb-2 text-sm font-medium text-[var(--text)]">Salary by position</h3>
        <ul className="space-y-2">
          {Object.entries(byPosition).sort((a, b) => b[1].salary - a[1].salary).map(([pos, row]) => (
            <li
              key={pos}
              className="flex items-center justify-between gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface2)] px-3 py-2 text-sm"
              data-testid={`salary-cap-builder-pos-${pos}`}
            >
              <span className="text-[var(--text)]">{pos} <span className="text-[var(--muted)]">· {row.count}</span></span>
              <span className="tabular-nums text-[var(--text)]">
                {formatCapMoney(row.salary)}
                {cap > 0 ? <span className="text-[var(--muted)]"> · {Math.round((row.salary / cap) * 100)}% of cap</span> : null}
              </span>
            </li>
          ))}
        </ul>

        <p className="mt-4 text-xs text-[var(--muted)]">
          Long-term risk: high salary + long term = less flexibility. Rookie contracts and
          short-term deals improve future cap health.
        </p>
      </section>
    </div>
  )
}
