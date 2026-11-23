'use client'

import { contractStatusLabel, formatCapMoney, yearsLeftIncludingThisSeason } from '@/lib/salary-cap/capMoney'
import { FileText, ArrowLeft } from 'lucide-react'
import type { SalaryCapSummary } from './types'

export function ContractsPage({
  summary,
  leagueId,
  onBack,
}: {
  summary: SalaryCapSummary
  leagueId: string
  /** Absent inside the league workspace, whose sidebar already navigates (SalaryCapHome `shellNav`). */
  onBack?: () => void
}) {
  const contracts = summary.contracts

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
          <FileText className="h-5 w-5 text-emerald-400" />
          Contracts
        </h2>

        {contracts.length === 0 ? (
          <p className="text-sm text-white/50">No active contracts.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-white/60">
                  <th className="pb-2 pr-2">Player</th>
                  <th className="pb-2 pr-2">Pos</th>
                  <th className="pb-2 pr-2 text-right">Salary</th>
                  <th className="pb-2 pr-2 text-right">Yrs left</th>
                  <th className="pb-2 pr-2">Source</th>
                  <th className="pb-2 pr-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {contracts.map((c) => (
                  <tr key={c.id} className="border-b border-white/5">
                    <td className="py-2 pr-2 font-medium text-white/90">
                      {c.playerName ?? c.playerId}
                    </td>
                    <td className="py-2 pr-2 text-white/70">{c.position ?? '—'}</td>
                    <td className="py-2 pr-2 text-right tabular-nums text-white/80">{formatCapMoney(c.salary)}</td>
                    <td className="py-2 pr-2 text-right tabular-nums text-white/80">
                      {yearsLeftIncludingThisSeason(c)}
                    </td>
                    <td className="py-2 pr-2 text-white/60 text-xs">
                      {c.source.replace(/_/g, ' ')}
                    </td>
                    <td className="py-2 pr-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs ${
                          c.status === 'tagged'
                            ? 'bg-amber-500/20 text-amber-200'
                            : c.status === 'option_exercised'
                              ? 'bg-cyan-500/20 text-cyan-200'
                              : 'bg-white/10 text-white/70'
                        }`}
                      >
                        {contractStatusLabel(c.status)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-4 text-xs text-white/50">
          Extension eligibility: in final contract year. Franchise tag: one per team if enabled.
          Cut/trade consequences shown in transaction flows.
        </p>
      </section>
    </div>
  )
}
