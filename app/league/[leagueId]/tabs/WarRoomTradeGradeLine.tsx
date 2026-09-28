'use client'

import type { SuggestionGrade } from '@/lib/trade-intel/partnerRanking'

/**
 * THE grade on the War Room's trade analyzer, redraft and dynasty (2026-09-28) — in place of the
 * engines' own accept/reject/neutral verdict. See lib/decision-os/trade/warRoomTradeGrade.ts.
 */
export function WarRoomTradeGradeLine({ grade, testId }: { grade: SuggestionGrade | null | undefined; testId: string }) {
  if (!grade) return null
  if (!grade.graded) {
    return (
      <p data-testid={`${testId}-withheld`} className="text-amber-200/85">
        Not graded: {grade.reason}
      </p>
    )
  }
  return (
    <div data-testid={testId}>
      <p className="font-semibold text-white/85">
        League grade: You {grade.letter} · Them {grade.partnerLetter}
        {grade.label ? <span className="font-normal text-white/55"> — {grade.label}</span> : null}
      </p>
      <p className="text-white/45">
        You get {Math.round(grade.getValue).toLocaleString()} for {Math.round(grade.giveValue).toLocaleString()} in league value
      </p>
    </div>
  )
}
