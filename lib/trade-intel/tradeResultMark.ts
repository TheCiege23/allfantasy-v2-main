import type { TradeSideGrade } from '@/lib/trade-intel/sleeperTradeGradeService'

/**
 * The OUTCOME of a completed trade for one side, for the share card (`app/api/share/trade-card`).
 * PURE.
 *
 * 🛑 A RESULT, NOT A GRADE (Trade OS, 2026-09-27). It is drawn from the points each side's assets
 * actually scored while held, and it is a word — WON / LOST / EVEN — never a letter. The one trade
 * grade is a judgement of VALUE at the time; a second letter from realized points, on its own scale,
 * would put two grades on one trade. The design keeps the observed result separate from the grade and
 * never lets it rewrite one.
 */
export type ResultMark = { mark: string; caption: string; color: string }

/** The outcome for one side, from its net points. No letter, ever. */
export function resultMark(
  side: Pick<TradeSideGrade, 'cumulativeNet' | 'trend'>,
  opts: { provisional: boolean; tie: boolean },
): ResultMark {
  if (opts.provisional) return { mark: '—', caption: 'no points scored yet', color: '#5d64a3' }
  const trend = side.trend === 'improving' || side.trend === 'worsening' ? side.trend : 'steady'
  if (opts.tie || side.cumulativeNet === 0) return { mark: 'EVEN', caption: `result so far · ${trend}`, color: '#7fb3ff' }
  return side.cumulativeNet > 0
    ? { mark: 'WON', caption: `result so far · ${trend}`, color: '#3ddc97' }
    : { mark: 'LOST', caption: `result so far · ${trend}`, color: '#ff6b8b' }
}

