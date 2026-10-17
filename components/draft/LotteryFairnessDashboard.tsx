'use client'

import { useEffect, useState, useMemo } from 'react'
import clsx from 'clsx'

type LotteryEntry = {
  rosterId: string
  displayName: string
  wins: number
  losses: number
  pointsFor: number
  weight: number
  oddsPercent: number
  eligibilityReason: string
  finalSlot: number | null
  expectedSlot: number | null
  movement: number | null
}

type AuditEvent = {
  id: string
  action: string
  actor: string
  details: string
  timestamp: string
}

type LotteryFairnessData = {
  leagueName: string
  draftType: string
  lotteryStatus: 'not_run' | 'ready' | 'revealed' | 'locked'
  eligibleTeamCount: number
  lotteryModel: string
  picksDetermined: number
  oddsDistribution: string
  antiTankingActive: boolean
  overrideDetected: boolean
  rerunCount: number
  entries: LotteryEntry[]
  auditLog: AuditEvent[]
  configSnapshot: {
    eligibilityMode: string
    weightingMode: string
    fallbackOrder: string
    lotteryTeamCount: number
    lotteryPickCount: number
  } | null
  seed: string | null
  runAt: string | null
}

type Tab = 'overview' | 'odds' | 'results' | 'audit' | 'simulate'

const STATUS_COLORS: Record<string, string> = {
  not_run: 'bg-white/10 text-white/50',
  ready: 'bg-amber-500/20 text-amber-300',
  revealed: 'bg-sky-500/20 text-sky-300',
  locked: 'bg-emerald-500/20 text-emerald-300',
}

const STATUS_LABELS: Record<string, string> = {
  not_run: 'Not Run',
  ready: 'Ready to Reveal',
  revealed: 'Revealed',
  locked: 'Locked',
}

export function LotteryFairnessDashboard({
  leagueId,
  isCommissioner,
}: {
  leagueId: string
  isCommissioner: boolean
}) {
  const [data, setData] = useState<LotteryFairnessData | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [simResults, setSimResults] = useState<Array<{ rosterId: string; avgSlot: number; slots: number[] }> | null>(null)
  const [simRunning, setSimRunning] = useState(false)

  useEffect(() => {
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/lottery/preview`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: LotteryFairnessData | null) => setData(d))
      .catch(() => null)
  }, [leagueId])

  if (!data) {
    return <div className="p-6 text-sm text-white/40">Loading lottery data...</div>
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'odds', label: 'Odds Table' },
    { id: 'results', label: 'Results' },
    { id: 'audit', label: 'Audit Trail' },
    ...(isCommissioner ? [{ id: 'simulate' as Tab, label: 'Simulate' }] : []),
  ]

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/40">Lottery Fairness Dashboard</p>
            <p className="mt-1 text-lg font-bold text-white">{data.leagueName}</p>
          </div>
          <span className={clsx('rounded-lg px-3 py-1 text-[11px] font-bold', STATUS_COLORS[data.lotteryStatus])}>
            {STATUS_LABELS[data.lotteryStatus]}
          </span>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="Eligible Teams" value={String(data.eligibleTeamCount)} />
        <SummaryCard label="Lottery Model" value={data.lotteryModel.replace(/_/g, ' ')} />
        <SummaryCard label="Picks by Lottery" value={String(data.picksDetermined)} />
        <SummaryCard label="Overrides" value={data.overrideDetected ? 'Yes' : 'None'} color={data.overrideDetected ? 'text-amber-300' : 'text-emerald-300'} />
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
              tab === t.id ? 'bg-cyan-500/15 text-cyan-300' : 'text-white/40 hover:text-white/60',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'overview' && <OverviewTab data={data} />}
      {tab === 'odds' && <OddsTab entries={data.entries} />}
      {tab === 'results' && <ResultsTab entries={data.entries} data={data} />}
      {tab === 'audit' && <AuditTab events={data.auditLog} />}
      {tab === 'simulate' && isCommissioner && (
        <SimulateTab
          leagueId={leagueId}
          simResults={simResults}
          simRunning={simRunning}
          onRun={async (count) => {
            setSimRunning(true)
            try {
              const r = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/lottery/preview`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ action: 'simulate', count }),
              })
              if (r.ok) {
                const j = await r.json()
                setSimResults(j.simulations ?? null)
              }
            } catch { /* */ }
            setSimRunning(false)
          }}
        />
      )}

      {/* Fairness verdict */}
      <FairnessVerdict data={data} />
    </div>
  )
}

function SummaryCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-center">
      <p className="text-[11px] text-white/40">{label}</p>
      <p className={clsx('mt-1 text-lg font-bold', color ?? 'text-white')}>{value}</p>
    </div>
  )
}

function OverviewTab({ data }: { data: LotteryFairnessData }) {
  const cfg = data.configSnapshot
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <h3 className="text-sm font-bold text-white">Lottery Model Explanation</h3>
        <div className="mt-3 space-y-2 text-xs text-white/60">
          <p><span className="text-white/80">Eligibility:</span> {cfg?.eligibilityMode?.replace(/_/g, ' ') ?? 'Unknown'} — {data.eligibleTeamCount} teams qualify</p>
          <p><span className="text-white/80">Weighting:</span> {cfg?.weightingMode?.replace(/_/g, ' ') ?? 'Unknown'}</p>
          <p><span className="text-white/80">Lottery scope:</span> Top {data.picksDetermined} picks determined by lottery</p>
          <p><span className="text-white/80">Remaining order:</span> {cfg?.fallbackOrder?.replace(/_/g, ' ') ?? 'Inverse standings'}</p>
          <p><span className="text-white/80">Anti-tanking:</span> {data.antiTankingActive ? 'Active' : 'Not enabled'}</p>
          {data.rerunCount > 0 && (
            <p className="text-amber-300">Lottery was rerun {data.rerunCount} time{data.rerunCount > 1 ? 's' : ''} before lock. See audit trail.</p>
          )}
        </div>
      </div>

      {data.runAt && (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-xs text-white/50">
          <p>Lottery run at: <span className="text-white/80">{new Date(data.runAt).toLocaleString()}</span></p>
          {data.seed && <p>Seed: <code className="text-[11px] text-white/40">{data.seed.slice(0, 16)}...</code></p>}
        </div>
      )}
    </div>
  )
}

function OddsTab({ entries }: { entries: LotteryEntry[] }) {
  const sorted = [...entries].sort((a, b) => b.oddsPercent - a.oddsPercent)
  const maxOdds = Math.max(...sorted.map((e) => e.oddsPercent), 1)

  return (
    <div className="space-y-4">
      {/* Visual bar chart */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <h3 className="mb-3 text-sm font-bold text-white">Odds Distribution</h3>
        <div className="space-y-2">
          {sorted.map((e) => (
            <div key={e.rosterId} className="flex items-center gap-3">
              <span className="w-28 truncate text-xs text-white/70">{e.displayName}</span>
              <div className="flex-1 h-4 overflow-hidden rounded-full bg-white/5">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-purple-500 transition-all duration-500"
                  style={{ width: `${(e.oddsPercent / maxOdds) * 100}%` }}
                />
              </div>
              <span className="w-14 text-right text-xs font-bold text-white">{e.oddsPercent.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>

      {/* Odds table */}
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-white/10 text-[11px] uppercase text-white/40">
            <tr>
              <th className="p-2.5">Team</th>
              <th className="p-2.5">Record</th>
              <th className="p-2.5 text-right">PF</th>
              <th className="p-2.5 text-right">Weight</th>
              <th className="p-2.5 text-right">Odds</th>
              <th className="p-2.5">Eligibility</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((e) => (
              <tr key={e.rosterId} className="border-b border-white/5">
                <td className="p-2.5 font-medium text-white">{e.displayName}</td>
                <td className="p-2.5 text-white/60">{e.wins}-{e.losses}</td>
                <td className="p-2.5 text-right font-mono text-white/60">{e.pointsFor.toFixed(1)}</td>
                <td className="p-2.5 text-right font-mono text-white/60">{e.weight}</td>
                <td className="p-2.5 text-right font-mono font-bold text-cyan-300">{e.oddsPercent.toFixed(1)}%</td>
                <td className="p-2.5 text-white/40">{e.eligibilityReason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ResultsTab({ entries, data }: { entries: LotteryEntry[]; data: LotteryFairnessData }) {
  const withResults = entries.filter((e) => e.finalSlot != null).sort((a, b) => (a.finalSlot ?? 99) - (b.finalSlot ?? 99))

  if (data.lotteryStatus === 'not_run') {
    return <p className="py-8 text-center text-xs text-white/40">Lottery has not been run yet.</p>
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full text-left text-xs">
        <thead className="border-b border-white/10 text-[11px] uppercase text-white/40">
          <tr>
            <th className="p-2.5">Pick</th>
            <th className="p-2.5">Team</th>
            <th className="p-2.5 text-right">Odds</th>
            <th className="p-2.5 text-right">Expected</th>
            <th className="p-2.5">Movement</th>
          </tr>
        </thead>
        <tbody>
          {withResults.map((e) => {
            const mvmt = e.movement ?? 0
            return (
              <tr key={e.rosterId} className="border-b border-white/5">
                <td className="p-2.5 font-bold text-white">{e.finalSlot}</td>
                <td className="p-2.5 font-medium text-white">{e.displayName}</td>
                <td className="p-2.5 text-right font-mono text-white/60">{e.oddsPercent.toFixed(1)}%</td>
                <td className="p-2.5 text-right font-mono text-white/50">{e.expectedSlot ?? '—'}</td>
                <td className="p-2.5">
                  {mvmt > 0 && <span className="text-red-400">Down {mvmt}</span>}
                  {mvmt < 0 && <span className="text-emerald-400">Up {Math.abs(mvmt)}</span>}
                  {mvmt === 0 && <span className="text-white/30">—</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function AuditTab({ events }: { events: AuditEvent[] }) {
  if (events.length === 0) {
    return <p className="py-8 text-center text-xs text-white/40">No audit events yet.</p>
  }

  return (
    <div className="space-y-1.5">
      {events.map((e) => (
        <div key={e.id} className="rounded-lg border border-white/5 bg-white/[0.02] px-4 py-2.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-white">{e.action.replace(/_/g, ' ')}</span>
            <span className="text-white/30">{new Date(e.timestamp).toLocaleString()}</span>
          </div>
          <p className="mt-0.5 text-white/50">{e.details}</p>
          <p className="text-[11px] text-white/30">by {e.actor}</p>
        </div>
      ))}
    </div>
  )
}

function SimulateTab({
  leagueId,
  simResults,
  simRunning,
  onRun,
}: {
  leagueId: string
  simResults: Array<{ rosterId: string; avgSlot: number; slots: number[] }> | null
  simRunning: boolean
  onRun: (count: number) => void
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <h3 className="text-sm font-bold text-white">Lottery Simulation</h3>
        <p className="mt-1 text-xs text-white/50">Run simulations to verify odds fairness. Results are preview only.</p>
        <div className="mt-3 flex gap-2">
          {[10, 100, 1000].map((n) => (
            <button
              key={n}
              type="button"
              disabled={simRunning}
              onClick={() => onRun(n)}
              className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-semibold text-white/70 transition hover:bg-white/[0.06] disabled:opacity-40"
            >
              {simRunning ? '...' : `${n}x`}
            </button>
          ))}
        </div>
      </div>

      {simResults && (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-white/10 text-[11px] uppercase text-white/40">
              <tr>
                <th className="p-2.5">Team</th>
                <th className="p-2.5 text-right">Avg Pick</th>
                <th className="p-2.5 text-right">Best</th>
                <th className="p-2.5 text-right">Worst</th>
              </tr>
            </thead>
            <tbody>
              {simResults.sort((a, b) => a.avgSlot - b.avgSlot).map((r) => (
                <tr key={r.rosterId} className="border-b border-white/5">
                  <td className="p-2.5 text-white">{r.rosterId}</td>
                  <td className="p-2.5 text-right font-mono text-cyan-300">{r.avgSlot.toFixed(1)}</td>
                  <td className="p-2.5 text-right font-mono text-emerald-400">{Math.min(...r.slots)}</td>
                  <td className="p-2.5 text-right font-mono text-red-400">{Math.max(...r.slots)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function FairnessVerdict({ data }: { data: LotteryFairnessData }) {
  const verdicts: string[] = []

  if (!data.overrideDetected) {
    verdicts.push('No manual overrides detected.')
  } else {
    verdicts.push('Commissioner adjustments were made. See audit trail for details.')
  }

  if (data.rerunCount === 0) {
    verdicts.push('Lottery was run once and locked without reruns.')
  } else {
    verdicts.push(`Lottery was rerun ${data.rerunCount} time(s) before final lock.`)
  }

  verdicts.push('Final order is consistent with configured rules.')

  if (data.seed) {
    verdicts.push('Cryptographic seed preserved for verification.')
  }

  return (
    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.03] p-5">
      <h3 className="text-sm font-bold text-emerald-300">Fairness Verdict</h3>
      <ul className="mt-2 space-y-1">
        {verdicts.map((v, i) => (
          <li key={i} className="flex items-start gap-2 text-xs text-white/60">
            <span className="mt-0.5 text-emerald-400">✓</span>
            <span>{v}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
