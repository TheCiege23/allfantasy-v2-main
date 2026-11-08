'use client'

import { Gavel, ArrowLeft, TrendingDown, Info } from 'lucide-react'
import type { SalaryCapSummary } from './types'

/** Per-round salary scale preview rows for display (snake leagues). */
const SNAKE_SCALE_PREVIEW = [
  { label: '1.01', pct: '100%', example: 'Highest salary' },
  { label: '1.02 – 1.03', pct: '85%', example: 'Second tier' },
  { label: '1.04 – 1.06', pct: '71%', example: 'Mid first round' },
  { label: '1.07 – 1.09', pct: '57%', example: 'Late first round' },
  { label: '1.10+', pct: '42%', example: 'End of round 1' },
  { label: 'Round 2', pct: '28%', example: 'Cost-controlled' },
  { label: 'Round 3', pct: '14%', example: 'Deep value' },
  { label: 'Round 4+', pct: '7%', example: 'Minimum / near-min' },
]

export function StartupAuctionView({
  summary,
  leagueId,
  onBack,
}: {
  summary: SalaryCapSummary
  leagueId: string
  /** Absent inside the league workspace, whose sidebar already navigates (SalaryCapHome `shellNav`). */
  onBack?: () => void
}) {
  const config = summary.config
  const isSnake = config.startupDraftType === 'snake'
  const isAuction = config.startupDraftType === 'auction' || !config.startupDraftType

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

      {/* Draft summary header */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
          <Gavel className="h-5 w-5 text-emerald-400" />
          {isSnake ? 'Snake Salary-Scale Draft' : 'Startup Auction Draft'}
        </h2>

        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <dt className="text-xs text-white/50">Startup draft type</dt>
            <dd className="text-sm font-medium text-white/90 capitalize">
              {isSnake ? 'Snake (salary scale)' : 'Auction'}
            </dd>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <dt className="text-xs text-white/50">Future acquisition draft</dt>
            <dd className="text-sm font-medium text-white/90 capitalize">
              {config.futureDraftType?.replace(/_/g, ' ') ?? 'Snake (rookie scale)'}
            </dd>
          </div>
          {isAuction && (
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <dt className="text-xs text-white/50">Auction holdback</dt>
              <dd className="text-sm font-medium text-white/90">${config.auctionHoldback}</dd>
            </div>
          )}
          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <dt className="text-xs text-white/50">Rookie contract years</dt>
            <dd className="text-sm font-medium text-white/90">{config.rookieContractYears} yrs</dd>
          </div>
        </dl>

        {/* Auction-specific info */}
        {isAuction && (
          <div className="mt-6 rounded-xl border border-amber-500/20 bg-amber-950/20 p-4">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-200">
              <Info className="h-4 w-4" /> Auction salary rules
            </h3>
            <ul className="space-y-1 text-sm text-white/70">
              <li>• Winning bid becomes the player&apos;s contract salary</li>
              <li>• Holdback (${config.auctionHoldback}) stays locked until all drafts are complete</li>
              <li>• Available cap = total cap − holdback until draft finishes</li>
              <li>• Contract years assigned per league settings ({config.rookieContractYears} yr default)</li>
              <li>• Cap legality checked before each bid — over-cap bids are rejected</li>
            </ul>
          </div>
        )}

        {/* Snake-specific info */}
        {isSnake && (
          <div className="mt-6 space-y-4">
            <div className="rounded-xl border border-cyan-500/20 bg-cyan-950/20 p-4">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-cyan-200">
                <TrendingDown className="h-4 w-4" /> Rookie salary scale
              </h3>
              <p className="mb-3 text-sm text-white/70">
                Every drafted player receives a salary based on their pick position — earlier picks
                cost more cap space, later picks are cheaper. Salaries are auto-assigned at draft
                time and persisted into player contracts immediately.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-white/40">
                      <th className="pb-2 text-left">Pick range</th>
                      <th className="pb-2 text-right">Scale %</th>
                      <th className="pb-2 text-right">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {SNAKE_SCALE_PREVIEW.map((row) => (
                      <tr key={row.label} className="border-t border-white/5">
                        <td className="py-1.5 text-white/80">{row.label}</td>
                        <td className="py-1.5 text-right tabular-nums text-emerald-300">{row.pct}</td>
                        <td className="py-1.5 text-right text-white/50">{row.example}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-white/40">
                Scale is percentage of base salary (cap × 4.5%). Exact values depend on your cap
                size and salary curve setting. View the Rookie Scale tab in Commissioner Settings to
                preview exact salaries for your league.
              </p>
            </div>

            <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-white/70">
              <p className="font-medium text-white/90 mb-1">Why snake salary scale?</p>
              <p>
                Snake salary-scale contracts mirror real-world rookie deals — top picks command
                premium salaries while late-round picks are cap-friendly bargains. Early picks are
                high-cost, high-upside assets. Later picks are cheap depth with minimal cap risk if
                they don&apos;t work out.
              </p>
            </div>
          </div>
        )}

        {/* Weighted lottery info */}
        {config.weightedLotteryEnabled && (
          <div className="mt-6 rounded-xl border border-cyan-500/30 bg-cyan-950/20 p-4">
            <h3 className="mb-2 text-sm font-medium text-cyan-200">Weighted lottery</h3>
            <p className="text-sm text-white/70">
              Future rookie draft order is determined by weighted lottery. Non-playoff teams receive
              lottery balls based on final standings (worst record = most balls). Lottery seed is
              stored for audit transparency.
            </p>
            {summary.lottery?.order != null ? (
              <p className="mt-2 text-xs text-white/50">
                Lottery result this season:{' '}
                {Array.isArray(summary.lottery.order)
                  ? `${(summary.lottery.order as unknown[]).length} slots resolved`
                  : '—'}
              </p>
            ) : null}
          </div>
        )}
      </section>

      {/* Contract lifecycle reminder */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
        <h3 className="mb-3 text-sm font-semibold text-white/80">Contract lifecycle</h3>
        <ul className="space-y-1.5 text-sm text-white/70">
          <li>• Drafted players immediately receive contracts in the cap ledger</li>
          <li>• Contract salaries count against team cap from day 1</li>
          {config.deadMoneyEnabled && (
            <li>• Cutting a player before contract expiry creates a dead money cap charge</li>
          )}
          {config.extensionsEnabled && (
            <li>• Players in their final contract year can be extended (1 extension/team/season)</li>
          )}
          {config.franchiseTagEnabled && (
            <li>• Franchise tags retain expiring players at top-of-market salary (once per player)</li>
          )}
          {config.rolloverEnabled && (
            <li>• Unused cap up to ${config.rolloverMax} rolls over into the next season</li>
          )}
        </ul>
        <a
          href={`/league/${leagueId}?tab=Settings`}
          className="mt-4 inline-block text-sm text-cyan-400 hover:underline"
        >
          Configure draft & contract settings →
        </a>
      </section>
    </div>
  )
}
