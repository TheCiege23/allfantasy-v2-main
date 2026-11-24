'use client'

import { useMemo, useState } from 'react'
import type { IdpSalaryRecordJson } from '@/app/idp/hooks/useIdpTeamCap'

type Tab = 'ALL' | 'OFFENSE' | 'DEFENSE' | 'EXPIRING' | 'DEAD_CAP'

type Props = {
  contracts: IdpSalaryRecordJson[]
  onCut?: (row: IdpSalaryRecordJson) => void
  onExtend?: (row: IdpSalaryRecordJson) => void
  onTag?: (row: IdpSalaryRecordJson) => void
  compact?: boolean
}

const TAB_LABEL: Record<Tab, string> = { ALL: 'All', OFFENSE: 'Offense', DEFENSE: 'Defense', EXPIRING: 'Expiring', DEAD_CAP: 'Dead money' }

/** "franchise_tagged" → "Tagged"; the table printed the stored status. */
function contractStatusLabel(c: IdpSalaryRecordJson): string {
  if (c.status === 'cut') return 'Cut'
  if (c.isFranchiseTagged || c.status === 'franchise_tagged') return 'Tagged'
  if (c.yearsRemaining <= 1) return 'Expiring'
  return c.status === 'active' ? 'Active' : c.status.replace(/_/g, ' ')
}

function isOffensePos(pos: string) {
  const p = pos.toUpperCase()
  return ['QB', 'RB', 'WR', 'TE', 'K', 'FLEX', 'SUPER_FLEX', 'TQB'].some((x) => p.includes(x))
}

export function ContractsTable({ contracts, onCut, onExtend, onTag, compact }: Props) {
  const [tab, setTab] = useState<Tab>('ALL')

  const rows = useMemo(() => {
    let list = [...contracts]
    if (tab === 'OFFENSE') list = list.filter((c) => !c.isDefensive && isOffensePos(c.position))
    if (tab === 'DEFENSE') list = list.filter((c) => c.isDefensive || !isOffensePos(c.position))
    if (tab === 'EXPIRING') list = list.filter((c) => c.yearsRemaining <= 1 && c.status === 'active')
    if (tab === 'DEAD_CAP') list = list.filter((c) => c.status === 'cut')
    return list.sort((a, b) => b.salary - a.salary)
  }, [contracts, tab])

  return (
    <div className="space-y-3" data-testid="contracts-table">
      <div className="flex flex-wrap gap-1">
        {(['ALL', 'OFFENSE', 'DEFENSE', 'EXPIRING', 'DEAD_CAP'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-lg px-2.5 py-1 text-[11px] font-bold ${
              tab === t ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'text-[var(--muted)] hover:bg-[var(--chip)]'
            }`}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>
      {/* A phone reads a list; the nine-column table was cut off at 390px (2026-11-23). */}
      <ul className="space-y-1.5 sm:hidden" data-testid="contracts-list">
        {rows.map((c) => (
          <li key={c.id} className="rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-[13px] font-semibold text-[var(--text)]">{c.playerName}</span>
              <span className="shrink-0 text-[13px] font-semibold text-[var(--text)]">${c.salary.toFixed(1)}M</span>
            </div>
            <p className="text-[11px] text-[var(--muted)]">
              {c.position} · {c.yearsRemaining} {c.yearsRemaining === 1 ? 'year' : 'years'} left · {contractStatusLabel(c)}
              {c.cutPenaltyCurrent != null ? ` · cut costs $${c.cutPenaltyCurrent.toFixed(1)}M` : ''}
            </p>
            {!compact && (c.status === 'active' || c.status === 'franchise_tagged') ? (
              <div className="mt-1.5 flex gap-1.5">
                <button type="button" className="rounded border border-[var(--bad)] px-2 py-0.5 text-[11px] text-[var(--bad)]" onClick={() => onCut?.(c)}>Cut</button>
                <button type="button" className="rounded border border-[var(--accent-line)] px-2 py-0.5 text-[11px] text-[var(--accent)]" onClick={() => onExtend?.(c)}>Extend</button>
                <button type="button" className="rounded border border-[var(--line2)] px-2 py-0.5 text-[11px] text-[var(--warn)]" onClick={() => onTag?.(c)}>Tag</button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto rounded-xl border border-[var(--line)] sm:block">
        <table className="w-full min-w-[640px] text-left text-[11px] text-[var(--text)]">
          <thead className="border-b border-[var(--line)] bg-[var(--surface2)] text-[11px] uppercase tracking-wide text-[var(--muted)]">
            <tr>
              <th className="px-2 py-2">Player</th>
              <th className="px-2 py-2">Pos</th>
              <th className="px-2 py-2">🛡/⚔</th>
              <th className="px-2 py-2">Salary</th>
              <th className="px-2 py-2">Yrs</th>
              <th className="px-2 py-2">Total</th>
              <th className="px-2 py-2">Cut $</th>
              <th className="px-2 py-2">Status</th>
              {!compact ? <th className="px-2 py-2">Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const exp = c.yearsRemaining <= 1
              const tagged = c.isFranchiseTagged || c.status === 'franchise_tagged'
              const dead = c.status === 'cut'
              const border =
                tagged ? 'border-l-4 border-[var(--line2)]' : exp ? 'border-l-4 border-[color:var(--cap-amber)]' : ''
              const rowBg = dead
                ? 'opacity-50 italic bg-[var(--chip)]'
                : c.isDefensive
                  ? 'bg-red-500/[0.06]'
                  : ''
              return (
                <tr key={c.id} className={`border-t border-[var(--line)] ${border} ${rowBg}`}>
                  <td className="px-2 py-2 font-semibold text-[var(--text)]">{c.playerName}</td>
                  <td className="px-2 py-2 text-[var(--text2)]">{c.position}</td>
                  <td className="px-2 py-2">{c.isDefensive ? '🛡' : '⚔'}</td>
                  <td className="px-2 py-2">${c.salary.toFixed(1)}M</td>
                  <td className="px-2 py-2">{c.yearsRemaining}</td>
                  <td className="px-2 py-2">${(c.salary * c.yearsRemaining).toFixed(1)}M</td>
                  <td className="px-2 py-2 text-[color:var(--cap-dead)]">
                    {c.cutPenaltyCurrent != null ? `$${c.cutPenaltyCurrent.toFixed(1)}M` : '—'}
                  </td>
                  <td className="px-2 py-2 text-[var(--muted)]">{contractStatusLabel(c)}</td>
                  {!compact ? (
                    <td className="space-x-1 px-2 py-2">
                      {c.status === 'active' || c.status === 'franchise_tagged' ? (
                        <>
                          <button
                            type="button"
                            className="rounded border border-[var(--bad)] px-1.5 py-0.5 text-[11px] text-[var(--bad)]"
                            onClick={() => onCut?.(c)}
                          >
                            Cut
                          </button>
                          <button
                            type="button"
                            className="rounded border border-[var(--accent-line)] px-1.5 py-0.5 text-[11px] text-[var(--accent)]"
                            onClick={() => onExtend?.(c)}
                          >
                            Extend
                          </button>
                          <button
                            type="button"
                            className="rounded border border-[var(--line2)] px-1.5 py-0.5 text-[11px] text-[var(--warn)]"
                            onClick={() => onTag?.(c)}
                          >
                            Tag
                          </button>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                  ) : null}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
