import type { ReactNode } from 'react'
import type { TradeBreakdown } from '@/lib/legacy/tradeBreakdown'

/**
 * The /af-legacy "Trade Breakdown" cards: the assets each side of the graded deal moves, with the
 * analyzer's total value beside each. The lists come from the request that produced the result
 * (`lib/legacy/tradeBreakdown.ts`), never from page state that a later edit could change.
 *
 * `youGetValue` is the analyzer's `sideAValue` (what Team A — the user — receives) and `youGiveValue`
 * its `sideBValue`, matching the lists' orientation.
 */
export default function TradeBreakdownSides({
  breakdown,
  youGetValue,
  youGiveValue,
}: {
  breakdown: TradeBreakdown | null | undefined
  youGetValue?: ReactNode
  youGiveValue?: ReactNode
}) {
  const youGet = breakdown?.youGet ?? []
  const youGive = breakdown?.youGive ?? []
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
      {/* Side A Card */}
      <div className="rounded-2xl bg-gradient-to-br from-cyan-500/10 to-cyan-500/5 border border-cyan-500/20 p-4" data-testid="trade-breakdown-you-get">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/30 flex items-center justify-center text-sm">👤</div>
          <span className="font-semibold text-cyan-400">You Get</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {youGet.map((label, idx) => (
            <span key={idx} className="px-3 py-1.5 rounded-lg bg-black/40 border border-cyan-500/30 text-sm text-white">
              {label}
            </span>
          ))}
        </div>
        {youGetValue ? (
          <div className="mt-3 pt-3 border-t border-cyan-500/20 text-right">
            <span className="text-xs text-white/50">Total Value: </span>
            <span className="text-lg font-bold text-cyan-400">{youGetValue}</span>
          </div>
        ) : null}
      </div>

      {/* Side B Card */}
      <div className="rounded-2xl bg-gradient-to-br from-purple-500/10 to-purple-500/5 border border-purple-500/20 p-4" data-testid="trade-breakdown-you-give">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-purple-500/30 flex items-center justify-center text-sm">👥</div>
          <span className="font-semibold text-purple-400">You Give</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {youGive.map((label, idx) => (
            <span key={idx} className="px-3 py-1.5 rounded-lg bg-black/40 border border-purple-500/30 text-sm text-white">
              {label}
            </span>
          ))}
        </div>
        {youGiveValue ? (
          <div className="mt-3 pt-3 border-t border-purple-500/20 text-right">
            <span className="text-xs text-white/50">Total Value: </span>
            <span className="text-lg font-bold text-purple-400">{youGiveValue}</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
