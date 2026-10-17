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
              tab === t ? 'bg-sky-500/20 text-sky-100' : 'text-white/45 hover:bg-white/[0.04]'
            }`}
          >
            {t.replace(/_/g, ' ')}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
        <table className="w-full min-w-[640px] text-left text-[11px] text-white/85">
          <thead className="border-b border-white/[0.06] bg-black/30 text-[11px] uppercase tracking-wide text-white/45">
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
                tagged ? 'border-l-4 border-amber-400/80' : exp ? 'border-l-4 border-[color:var(--cap-amber)]' : ''
              const rowBg = dead
                ? 'opacity-50 italic bg-white/[0.02]'
                : c.isDefensive
                  ? 'bg-red-500/[0.06]'
                  : ''
              return (
                <tr key={c.id} className={`border-t border-white/[0.04] ${border} ${rowBg}`}>
                  <td className="px-2 py-2 font-semibold text-white">{c.playerName}</td>
                  <td className="px-2 py-2 text-white/60">{c.position}</td>
                  <td className="px-2 py-2">{c.isDefensive ? '🛡' : '⚔'}</td>
                  <td className="px-2 py-2">${c.salary.toFixed(1)}M</td>
                  <td className="px-2 py-2">{c.yearsRemaining}</td>
                  <td className="px-2 py-2">${(c.salary * c.yearsRemaining).toFixed(1)}M</td>
                  <td className="px-2 py-2 text-[color:var(--cap-dead)]">
                    {c.cutPenaltyCurrent != null ? `$${c.cutPenaltyCurrent.toFixed(1)}M` : '—'}
                  </td>
                  <td className="px-2 py-2 text-white/55">{c.status}</td>
                  {!compact ? (
                    <td className="space-x-1 px-2 py-2">
                      {c.status === 'active' || c.status === 'franchise_tagged' ? (
                        <>
                          <button
                            type="button"
                            className="rounded border border-red-500/35 px-1.5 py-0.5 text-[11px] text-red-200"
                            onClick={() => onCut?.(c)}
                          >
                            Cut
                          </button>
                          <button
                            type="button"
                            className="rounded border border-sky-500/35 px-1.5 py-0.5 text-[11px] text-sky-200"
                            onClick={() => onExtend?.(c)}
                          >
                            Extend
                          </button>
                          <button
                            type="button"
                            className="rounded border border-amber-500/35 px-1.5 py-0.5 text-[11px] text-amber-200"
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
