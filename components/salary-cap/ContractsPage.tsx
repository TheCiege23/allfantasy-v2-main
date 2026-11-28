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
          className="inline-flex items-center gap-2 text-sm text-[var(--text2)] hover:text-[var(--text)]"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
      ) : null}

      <section className="rounded-2xl border border-[var(--line)] bg-white/[0.03] p-4 sm:p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-[var(--text)]">
          <FileText className="h-5 w-5 text-[var(--good)]" />
          Contracts
        </h2>

        {contracts.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No active contracts.</p>
        ) : (
          <>
          {/* Phone (2026-11-23): one line per contract. The 600px table showed only the Player column at 390px. */}
          <ul className="space-y-2 sm:hidden" data-testid="salary-cap-contracts-list">
            {contracts.map((c) => {
              const yrs = yearsLeftIncludingThisSeason(c)
              return (
                <li key={c.id} className="rounded-xl border border-[var(--line)] bg-[var(--surface2)] px-3 py-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 break-words font-semibold text-[var(--text)]">{c.playerName ?? 'Player'}</span>
                    <span className="shrink-0 font-semibold tabular-nums text-[var(--text)]">{formatCapMoney(c.salary)}</span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[var(--text2)]">
                    <span>{c.position ?? '—'}</span>
                    <span>· {yrs} {yrs === 1 ? 'yr' : 'yrs'} left</span>
                    {c.status !== 'active' ? (
                      <span className={`rounded px-1.5 py-0.5 ${c.status === 'tagged' ? 'bg-[var(--warn-soft)] text-[var(--warn)]' : 'bg-[var(--chip)] text-[var(--text2)]'}`}>{contractStatusLabel(c.status)}</span>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[600px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] text-[var(--text2)]">
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
                  <tr key={c.id} className="border-b border-[var(--line)]">
                    <td className="py-2 pr-2 font-medium text-[var(--text)]">
                      {c.playerName ?? 'Player'}
                    </td>
                    <td className="py-2 pr-2 text-[var(--text2)]">{c.position ?? '—'}</td>
                    <td className="py-2 pr-2 text-right tabular-nums text-[var(--text)]">{formatCapMoney(c.salary)}</td>
                    <td className="py-2 pr-2 text-right tabular-nums text-[var(--text)]">
                      {yearsLeftIncludingThisSeason(c)}
                    </td>
                    <td className="py-2 pr-2 text-[var(--text2)] text-xs">
                      {c.source.replace(/_/g, ' ')}
                    </td>
                    <td className="py-2 pr-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs ${
                          c.status === 'tagged'
                            ? 'bg-[var(--warn-soft)] text-[var(--warn)]'
                            : c.status === 'option_exercised'
                              ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                              : 'bg-[var(--chip)] text-[var(--text2)]'
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
          </>
        )}

        <p className="mt-4 text-xs text-[var(--muted)]">
          You can extend a player in his final contract year. One franchise tag per team, if your league uses it.
        </p>
      </section>
    </div>
  )
}
