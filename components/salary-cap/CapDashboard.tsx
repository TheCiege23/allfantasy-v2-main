'use client'

import { formatCapMoney, isOverCap } from '@/lib/salary-cap/capMoney'
import { Wallet, AlertTriangle, ArrowLeft } from 'lucide-react'
import type { SalaryCapSummary } from './types'

export function CapDashboard({
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
  const effectiveCap = config.startupCap + (ledger?.rolloverUsed ?? 0)
  const totalHit = (ledger?.totalCapHit ?? 0) + (ledger?.deadMoneyHit ?? 0)
  const overCap = totalHit > effectiveCap
  const underFloor =
    config.capFloorEnabled && config.capFloorAmount != null && ledger && totalHit < config.capFloorAmount

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
          <Wallet className="h-5 w-5 text-[var(--good)]" />
          Cap Dashboard
        </h2>

        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-[var(--line)] bg-[var(--surface2)] p-4">
            <p className="text-xs text-[var(--muted)]">{overCap ? 'Over the cap by' : 'Current cap space'}</p>
            <p className={`text-2xl font-bold ${overCap ? 'text-[var(--bad)]' : 'text-[var(--good)]'}`}>
              {ledger ? (overCap ? formatCapMoney(totalHit - effectiveCap) : formatCapMoney(ledger.capSpace)) : '—'}
            </p>
          </div>
          <div className="rounded-xl border border-[var(--line)] bg-[var(--surface2)] p-4">
            {/* totalCapHit is active contracts only; dead money is the next tile (CapCalculationService). */}
            <p className="text-xs text-[var(--muted)]">Active contracts (this year)</p>
            <p className="text-2xl font-semibold text-[var(--text)]">
              {ledger ? formatCapMoney(ledger.totalCapHit) : '—'}
            </p>
          </div>
          <div className="rounded-xl border border-[var(--line)] bg-[var(--surface2)] p-4">
            <p className="text-xs text-[var(--muted)]">Dead money</p>
            <p className="text-2xl font-semibold text-[var(--warn)]">
              {formatCapMoney(summary.deadMoneyTotal)}
            </p>
          </div>
          <div className="rounded-xl border border-[var(--line)] bg-[var(--surface2)] p-4">
            <p className="text-xs text-[var(--muted)]">Effective cap (with rollover)</p>
            <p className="text-xl font-semibold text-[var(--text)]">{formatCapMoney(effectiveCap)}</p>
          </div>
          <div className="rounded-xl border border-[var(--line)] bg-[var(--surface2)] p-4">
            <p className="text-xs text-[var(--muted)]">Rollover used</p>
            <p className="text-xl font-semibold text-[var(--text)]">
              {formatCapMoney(ledger?.rolloverUsed ?? 0)}
            </p>
          </div>
        </div>

        {/* Over the cap is said once, on the first tile (2026-11-23: tile, warning box and the 2026 row all said $12). */}
        {underFloor && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-[var(--line2)] bg-[var(--warn-soft)] p-3">
            <AlertTriangle className="h-5 w-5 shrink-0 text-[var(--warn)]" />
            <p className="text-sm text-[var(--warn)]">You are below the cap floor.</p>
          </div>
        )}

        <div className="mt-6">
          <h3 className="mb-2 text-sm font-medium text-[var(--text)]">Next seasons</h3>
          <ul className="space-y-2">
            {summary.futureProjection.filter((y) => y.capYear !== (summary.ledger?.capYear ?? summary.league?.capYear)).map((y) => (
              <li
                key={y.capYear}
                className="flex items-center justify-between rounded-lg border border-[var(--line)] bg-[var(--surface2)] px-3 py-2 text-sm"
              >
                <span className="text-[var(--text)]">{y.capYear}</span>
                <span className="tabular-nums text-[var(--text)]">{formatCapMoney(y.totalCapHit + y.deadMoney)} committed</span>
                <span className={`tabular-nums ${isOverCap(y.projectedSpace) ? 'text-[var(--bad)]' : 'text-[var(--good)]'}`}>
                  {isOverCap(y.projectedSpace) ? `${formatCapMoney(-y.projectedSpace)} over` : `${formatCapMoney(y.projectedSpace)} space`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  )
}
