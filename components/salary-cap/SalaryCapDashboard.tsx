'use client'

import { useEffect, useState } from 'react'
import clsx from 'clsx'

type CapSummary = {
  totalCap: number
  activeSalary: number
  deadMoney: number
  availableCap: number
  capUsedPct: number
  futureYears: Array<{ year: number; committed: number; available: number }>
  contracts: Array<{
    playerId: string
    playerName: string
    position: string
    team: string
    salary: number
    yearsRemaining: number
    totalYears: number
    status: string
    contractSource: string
  }>
}

export function SalaryCapDashboard({ leagueId }: { leagueId: string }) {
  const [data, setData] = useState<CapSummary | null>(null)
  const [tab, setTab] = useState<'roster' | 'cap' | 'future'>('roster')

  useEffect(() => {
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/salary-cap/summary`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { summary?: CapSummary } | null) => {
        if (d?.summary) setData(d.summary)
      })
      .catch(() => null)
  }, [leagueId])

  if (!data) {
    return <div className="p-4 text-sm text-white/40">Loading cap data...</div>
  }

  const capPct = data.capUsedPct
  const capColor = capPct > 90 ? 'bg-red-500' : capPct > 75 ? 'bg-amber-500' : 'bg-emerald-500'

  const tabs = [
    { id: 'roster' as const, label: 'Contracts' },
    { id: 'cap' as const, label: 'Cap Sheet' },
    { id: 'future' as const, label: 'Projections' },
  ]

  return (
    <div className="space-y-4">
      {/* Cap space bar */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <div className="flex items-center justify-between text-sm">
          <span className="text-white/60">Salary Cap</span>
          <span className="font-mono font-bold text-white">
            ${data.activeSalary.toFixed(0)} / ${data.totalCap.toFixed(0)}
          </span>
        </div>
        <div className="mt-2 h-3 overflow-hidden rounded-full bg-white/10">
          <div
            className={clsx('h-full rounded-full transition-all duration-500', capColor)}
            style={{ width: `${Math.min(100, capPct)}%` }}
          />
        </div>
        <div className="mt-2 flex justify-between text-xs text-white/40">
          <span>Available: ${data.availableCap.toFixed(0)}</span>
          {data.deadMoney > 0 && (
            <span className="text-red-400">Dead Money: ${data.deadMoney.toFixed(0)}</span>
          )}
          <span>{capPct.toFixed(1)}% used</span>
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-3">
        <StatBox label="Active Salary" value={`$${data.activeSalary.toFixed(0)}`} />
        <StatBox label="Dead Money" value={`$${data.deadMoney.toFixed(0)}`} color={data.deadMoney > 0 ? 'text-red-400' : undefined} />
        <StatBox label="Cap Space" value={`$${data.availableCap.toFixed(0)}`} color="text-emerald-400" />
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 rounded-xl border border-white/10 bg-white/[0.02] p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={clsx(
              'flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition',
              tab === t.id
                ? 'bg-cyan-500/15 text-cyan-300'
                : 'text-white/40 hover:text-white/60',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'roster' && <ContractsTab contracts={data.contracts} />}
      {tab === 'cap' && <CapSheetTab data={data} />}
      {tab === 'future' && <FutureTab years={data.futureYears} />}
    </div>
  )
}

function StatBox({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-center">
      <p className="text-[11px] text-white/40">{label}</p>
      <p className={clsx('text-lg font-bold', color ?? 'text-white')}>{value}</p>
    </div>
  )
}

function ContractsTab({ contracts }: { contracts: CapSummary['contracts'] }) {
  const sorted = [...contracts].sort((a, b) => b.salary - a.salary)

  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full min-w-[500px] text-left text-xs">
        <thead className="border-b border-white/10 text-[11px] uppercase text-white/40">
          <tr>
            <th className="p-2.5">Player</th>
            <th className="p-2.5">Pos</th>
            <th className="p-2.5 text-right">Salary</th>
            <th className="p-2.5 text-right">Contract</th>
            <th className="p-2.5">Source</th>
            <th className="p-2.5">Status</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((c) => (
            <tr key={c.playerId} className="border-b border-white/5 hover:bg-white/[0.02]">
              <td className="p-2.5 font-medium text-white">{c.playerName}</td>
              <td className="p-2.5 text-white/60">{c.position}</td>
              <td className="p-2.5 text-right font-mono text-cyan-300">${c.salary.toFixed(0)}</td>
              <td className="p-2.5 text-right text-white/60">
                {c.yearsRemaining}yr / {c.totalYears}yr
              </td>
              <td className="p-2.5 text-white/40">{c.contractSource?.replace(/_/g, ' ')}</td>
              <td className="p-2.5">
                <span
                  className={clsx(
                    'rounded px-1.5 py-0.5 text-[11px] font-bold',
                    c.status === 'active' ? 'bg-emerald-500/20 text-emerald-300' :
                    c.status === 'expiring' ? 'bg-amber-500/20 text-amber-300' :
                    'bg-white/10 text-white/40',
                  )}
                >
                  {c.status.toUpperCase()}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {sorted.length === 0 && (
        <p className="p-6 text-center text-xs text-white/30">No contracts yet.</p>
      )}
    </div>
  )
}

function CapSheetTab({ data }: { data: CapSummary }) {
  const activePct = (data.activeSalary / data.totalCap) * 100
  const deadPct = (data.deadMoney / data.totalCap) * 100
  const availPct = (data.availableCap / data.totalCap) * 100

  return (
    <div className="space-y-4">
      {/* Visual pie chart (simplified bar) */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <p className="mb-3 text-xs font-semibold text-white/60">Cap Breakdown</p>
        <div className="flex h-6 overflow-hidden rounded-full">
          <div className="bg-cyan-500" style={{ width: `${activePct}%` }} title={`Active: $${data.activeSalary.toFixed(0)}`} />
          <div className="bg-red-500" style={{ width: `${deadPct}%` }} title={`Dead: $${data.deadMoney.toFixed(0)}`} />
          <div className="bg-emerald-500/30" style={{ width: `${availPct}%` }} title={`Available: $${data.availableCap.toFixed(0)}`} />
        </div>
        <div className="mt-2 flex flex-wrap gap-4 text-[11px]">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-cyan-500" /> Active: ${data.activeSalary.toFixed(0)}</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" /> Dead: ${data.deadMoney.toFixed(0)}</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500/30" /> Available: ${data.availableCap.toFixed(0)}</span>
        </div>
      </div>
    </div>
  )
}

function FutureTab({ years }: { years: CapSummary['futureYears'] }) {
  if (years.length === 0) {
    return <p className="p-6 text-center text-xs text-white/30">No future projections available.</p>
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full text-left text-xs">
        <thead className="border-b border-white/10 text-[11px] uppercase text-white/40">
          <tr>
            <th className="p-2.5">Year</th>
            <th className="p-2.5 text-right">Committed</th>
            <th className="p-2.5 text-right">Available</th>
            <th className="p-2.5">Cap Health</th>
          </tr>
        </thead>
        <tbody>
          {years.map((y) => {
            const pct = y.available > 0 ? Math.round((y.available / (y.committed + y.available)) * 100) : 0
            return (
              <tr key={y.year} className="border-b border-white/5">
                <td className="p-2.5 font-bold text-white">{y.year}</td>
                <td className="p-2.5 text-right font-mono text-white/60">${y.committed.toFixed(0)}</td>
                <td className="p-2.5 text-right font-mono text-emerald-400">${y.available.toFixed(0)}</td>
                <td className="p-2.5">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-white/10">
                      <div
                        className={clsx('h-full rounded-full', pct > 30 ? 'bg-emerald-500' : pct > 15 ? 'bg-amber-500' : 'bg-red-500')}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-[11px] text-white/40">{pct}%</span>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
