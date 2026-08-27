'use client'

/**
 * ⚠ DESIGN MOCK. NOT WIRED TO ANY LEAGUE, AND NO LONGER MOUNTED.
 *
 * Every row here is invented: the three players are literals, the salaries and projections
 * come from hashes of their fake ids, and the cap room is a constant. It was rendered on the
 * draft tab of every IDP league until it was unmounted in `DraftTab`.
 *
 * The board half can be wired — the league-scored IDP valuation stack exists in
 * `lib/idp-projections/`. The cap half cannot: the salary, contract and cap tables have zero
 * rows in production. Keep this file out of the render tree until at least the board half is
 * real, and drop the cap columns rather than filling them in.
 */

import { useMemo, useState } from 'react'
import { mockContractSalaryM, mockIdpPoints } from './idpPositionUtils'

type PoolTab = 'ALL' | 'OFFENSE' | 'DEFENSE'
type DefSub = 'DL' | 'LB' | 'DB' | 'ALL'
type Tier = 1 | 2 | 3 | 4
type DraftMethod = 'auction' | 'snake' | 'hybrid'

const TIER_BORDER: Record<Tier, string> = {
  1: 'border-l-[color:var(--idp-td)]',
  2: 'border-l-[color:var(--idp-offense)]',
  3: 'border-l-emerald-500',
  4: 'border-l-white/25',
}

/** UI-only demo cap remaining (wire to league cap summary when available). */
const DEMO_CAP_REMAINING_M = 42.5

function snakePickSalary(pickIndex: number): { salaryM: number; years: number } {
  const top = 30
  const last = 1
  const rounds = 16
  const maxIdx = rounds * 12 - 1
  const t = Math.min(pickIndex, maxIdx) / maxIdx
  const salaryM = Math.round((last + (top - last) * (1 - t)) * 10) / 10
  const years = pickIndex < 24 ? 4 : pickIndex < 72 ? 3 : 2
  return { salaryM, years }
}

export type IDPDraftFiltersProps = {
  /** Current pick index in draft (0-based) for snake salary preview. */
  pickIndex?: number
}

export function IDPDraftFilters({ pickIndex = 7 }: IDPDraftFiltersProps) {
  const [tab, setTab] = useState<PoolTab>('ALL')
  const [defSub, setDefSub] = useState<DefSub>('ALL')
  const [sort, setSort] = useState<'proj' | 'adp' | 'name' | 'team'>('proj')
  const [lbScarcity] = useState(true)
  const [draftMethod, setDraftMethod] = useState<DraftMethod>('auction')
  const [demoBidM, setDemoBidM] = useState<number | null>(null)

  const rows = [
    { id: 'p1', rank: 4, name: 'Elite LB', team: 'BUF', pos: 'LB', role: 'Run Stopper', proj: 16.2, tier: 1 as Tier },
    { id: 'p2', rank: 11, name: 'Edge DE', team: 'DAL', pos: 'DL', role: 'Edge Rusher', proj: 14.1, tier: 2 as Tier },
    { id: 'p3', rank: 28, name: 'Box S', team: 'KC', pos: 'DB', role: 'Hybrid', proj: 11.4, tier: 3 as Tier },
  ]

  const snakeSlot = useMemo(() => snakePickSalary(pickIndex), [pickIndex])

  return (
    <div className="relative space-y-3 rounded-xl border border-[color:var(--idp-border)] bg-[color:var(--idp-panel)] p-4 pb-24 sm:pb-4">
      <div className="flex flex-wrap gap-1 border-b border-white/[0.06] pb-3">
        <span className="mr-2 self-center text-[10px] font-bold uppercase tracking-wide text-white/35">Draft salary</span>
        {(['auction', 'snake', 'hybrid'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setDraftMethod(m)}
            className={`rounded-lg px-2.5 py-1 text-[10px] font-bold capitalize ${
              draftMethod === m ? 'bg-cyan-500/20 text-cyan-100' : 'text-white/45 hover:bg-white/[0.04]'
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-1 border-b border-white/[0.06] pb-3">
        {(['ALL', 'OFFENSE', 'DEFENSE'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-lg px-3 py-1.5 text-[11px] font-bold ${
              tab === t
                ? t === 'OFFENSE'
                  ? 'bg-[color:var(--idp-offense)]/25 text-blue-100'
                  : t === 'DEFENSE'
                    ? 'bg-[color:var(--idp-defense)]/25 text-red-100'
                    : 'bg-violet-500/25 text-violet-100'
                : 'text-white/45 hover:bg-white/[0.04]'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {draftMethod === 'auction' || draftMethod === 'hybrid' ? (
        <div className="rounded-lg border border-[color:var(--cap-contract)]/30 bg-[color:var(--cap-contract)]/10 px-3 py-2 text-[11px] text-white/85">
          <span className="font-semibold text-cyan-100">Auction</span>
          <span className="text-white/50"> — Current bid fills in as nominations progress. Max affordable per row updates from your remaining cap.</span>
        </div>
      ) : null}

      {draftMethod === 'snake' || draftMethod === 'hybrid' ? (
        <div className="rounded-lg border border-white/[0.08] bg-black/30 px-3 py-2 text-[11px]">
          <p className="font-semibold text-white/90">Snake scale (preview)</p>
          <p className="mt-1 text-white/70">
            This pick <span className="font-mono text-[color:var(--cap-contract)]">#{pickIndex + 1}</span> ≈{' '}
            <span className="font-mono font-semibold text-white">
              ${snakeSlot.salaryM}M / {snakeSlot.years}yr
            </span>{' '}
            contract (from snake scale config).
          </p>
        </div>
      ) : null}

      {tab === 'DEFENSE' ? (
        <>
          {lbScarcity ? (
            <div className="rounded-lg border border-amber-500/35 bg-amber-950/30 px-3 py-2 text-[11px] font-semibold text-amber-100">
              🔥 LB SCARCITY — fewer than 30% of starter-tier LBs remain. Prioritize LB early.
            </div>
          ) : null}
          <div className="flex flex-wrap gap-1">
            {(['DL', 'LB', 'DB', 'ALL'] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDefSub(d === 'ALL' ? 'ALL' : d)}
                className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
                  defSub === d ? 'border-amber-400/50 bg-amber-500/15 text-amber-50' : 'border-white/10 text-white/45'
                }`}
              >
                {d === 'ALL' ? 'ALL DEF' : d}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] text-white/40">Sort</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof sort)}
              className="rounded-md border border-white/15 bg-black/40 px-2 py-1 text-[11px] text-white"
            >
              <option value="proj">Projected IDP pts</option>
              <option value="adp">ADP</option>
              <option value="name">Name</option>
              <option value="team">Team</option>
            </select>
          </div>
          <ul className="space-y-2">
            {rows.map((r) => {
              const sal = mockContractSalaryM(r.id)
              const proj = mockIdpPoints(r.id, 1).proj
              const perM = sal > 0.01 ? proj / sal : 0
              const maxAfford = Math.max(0, DEMO_CAP_REMAINING_M - (demoBidM ?? 0))
              const affordable = sal <= maxAfford + 0.01
              return (
                <li
                  key={r.name}
                  className={`flex flex-col gap-2 rounded-lg border border-white/[0.06] border-l-4 bg-white/[0.03] pl-2 pr-3 py-2 ${TIER_BORDER[r.tier]} ${
                    r.pos === 'LB' && lbScarcity ? 'bg-amber-500/10' : ''
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="w-6 text-center text-[11px] text-white/40">{r.rank}</span>
                    <div className="h-9 w-9 rounded-full bg-white/10" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-white">{r.name}</p>
                      <p className="text-[10px] text-white/45">
                        {r.team} · {r.pos} · {r.role}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-bold text-[color:var(--idp-defense)]">{r.proj}</p>
                      <p className="text-[9px] text-white/35">T{r.tier}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.05] pt-2 pl-8 text-[10px]">
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded border border-white/15 bg-black/30 px-2 py-0.5 font-mono text-white/70">
                        Bid: {demoBidM != null ? `$${demoBidM.toFixed(1)}M` : '$—'}
                      </span>
                      <span
                        className={`rounded border px-2 py-0.5 font-mono ${
                          affordable
                            ? 'border-[color:var(--cap-green)]/40 bg-[color:var(--cap-green)]/10 text-emerald-100'
                            : 'border-white/10 text-white/40'
                        }`}
                      >
                        Max affordable: ${maxAfford.toFixed(1)}M
                      </span>
                    </div>
                    <div className="text-right text-white/55">
                      <span className="rounded-full bg-[color:var(--cap-contract)]/15 px-2 py-0.5 font-mono text-[color:var(--cap-contract)]">
                        ${sal.toFixed(1)}M/yr
                      </span>
                      <p className="mt-0.5 text-[9px]">
                        Cap efficiency:{' '}
                        <span className="font-mono text-emerald-200/90">{perM.toFixed(2)} pts/$M</span> · proj {proj.toFixed(1)}/wk
                      </p>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
          <p className="text-[10px] text-white/35">
            Drafted players grey out with team logo — wire when draft pick stream is connected.
          </p>
        </>
      ) : (
        <p className="text-xs text-white/45">
          {tab === 'ALL'
            ? 'Showing full player pool. Switch to Defense for IDP-specific filters, cap previews, and tier borders.'
            : 'Offense pool uses your existing draft board (placeholder). Cap column appears when salary scale is enabled for the league.'}
        </p>
      )}

      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-white/10 bg-[#0a1228]/95 px-4 py-3 backdrop-blur-md sm:static sm:z-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:backdrop-blur-0">
        <div className="mx-auto flex max-w-lg flex-col gap-2 sm:max-w-none sm:flex-row sm:items-center sm:justify-between sm:rounded-lg sm:border sm:border-[color:var(--cap-contract)]/25 sm:bg-black/35 sm:px-3 sm:py-2">
          <div className="flex items-center justify-between gap-3 text-[11px] sm:justify-start">
            <span className="font-semibold text-white/80">Your cap remaining</span>
            <span className="font-mono text-sm font-bold text-[color:var(--cap-green)]">${DEMO_CAP_REMAINING_M.toFixed(1)}M</span>
          </div>
          {tab === 'DEFENSE' && (draftMethod === 'auction' || draftMethod === 'hybrid') ? (
            <div className="flex items-center gap-2 text-[10px] text-white/50">
              <span>Demo bid (tap)</span>
              <button
                type="button"
                onClick={() => setDemoBidM((b) => (b == null ? 8.5 : b >= 18 ? null : b + 4))}
                className="rounded-md border border-white/15 bg-white/[0.06] px-2 py-1 font-mono text-white/90"
              >
                {demoBidM != null ? `$${demoBidM.toFixed(1)}M` : 'Set bid'}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
