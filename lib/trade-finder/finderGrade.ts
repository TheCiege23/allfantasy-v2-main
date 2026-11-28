import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'

/**
 * THE grade on a trade-finder suggestion, in the compact shape every finder card reads (2026-11-26).
 *
 * The finders (/api/trade-finder, Partner Match, the league trade finder, the redraft package finder)
 * GENERATE candidates their own way — that is cheap and stays theirs — but every candidate they show
 * carries this grade, from `createLeagueTradeGrader` + `gradeDeal`, and every ranking or filter that
 * turns on value reads `percentDiff` / `giveValue` / `getValue` from it, never the finder's own values.
 *
 * `percentDiff` is the grader's, signed from the viewer's (give) side: + means the viewer receives more.
 */
export type FinderGrade =
  | {
      graded: true
      letter: 'A' | 'B' | 'C' | 'D' | 'F'
      partnerLetter: 'A' | 'B' | 'C' | 'D' | 'F'
      label: string
      giveValue: number
      getValue: number
      percentDiff?: number
    }
  | { graded: false; reason: string }

export function finderGradeOf(view: TradeGradeView): FinderGrade {
  if (!view.graded) return { graded: false, reason: view.reason }
  return {
    graded: true,
    letter: view.letter,
    partnerLetter: view.partnerLetter,
    label: view.label,
    giveValue: view.giveValue,
    getValue: view.getValue,
    ...(typeof view.percentDiff === 'number' && Number.isFinite(view.percentDiff) ? { percentDiff: view.percentDiff } : {}),
  }
}

/** The canonical value gap of a graded suggestion, from the viewer's side; null when it was not graded. */
export function gradeGapPct(grade: FinderGrade | null | undefined): number | null {
  if (!grade?.graded) return null
  if (typeof grade.percentDiff === 'number') return grade.percentDiff
  const scale = Math.max(grade.giveValue, grade.getValue)
  return scale > 0 ? ((grade.getValue - grade.giveValue) / scale) * 100 : null
}

export const GRADE_TIMED_OUT = 'The league trade grade did not answer in time.'
export const GRADE_FAILED = 'This trade could not be graded just now.'

/**
 * Grade every item with ONE grader (the caller closes over it), in parallel, under a time budget.
 * Never throws: an item whose grade fails reads `GRADE_FAILED`, and when the budget runs out every
 * item still unanswered reads `GRADE_TIMED_OUT` — a miss is said, never filled in with another
 * model's verdict.
 */
export async function gradeAllWithinBudget<T>(
  items: readonly T[],
  gradeOne: (item: T) => Promise<TradeGradeView>,
  budgetMs: number,
): Promise<FinderGrade[]> {
  const out: FinderGrade[] = items.map(() => ({ graded: false, reason: GRADE_TIMED_OUT }))
  if (items.length === 0) return out
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    Promise.all(
      items.map((item, i) =>
        Promise.resolve()
          .then(() => gradeOne(item))
          .then((view) => {
            out[i] = finderGradeOf(view)
          })
          .catch(() => {
            out[i] = { graded: false, reason: GRADE_FAILED }
          }),
      ),
    ),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, budgetMs)
    }),
  ])
  if (timer) clearTimeout(timer)
  // Snapshot: a grade that lands after the budget must not mutate what was already returned.
  return out.map((g) => ({ ...g }))
}
