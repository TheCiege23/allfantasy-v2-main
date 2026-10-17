'use client'

import type { SuggestionGrade } from '@/lib/trade-intel/partnerRanking'

/**
 * THE grade on the War Room's trade analyzer, all five War Rooms (2026-09-28/29) — in place of the
 * engines' own accept/reject/neutral verdict. See lib/decision-os/trade/warRoomTradeGrade.ts.
 */
/** Said when the route sent no grade at all (an older server, a failed request) — see below. */
export const WAR_ROOM_NO_GRADE_REASON = 'This trade could not be graded just now.'

export function WarRoomTradeGradeLine({ grade, testId }: { grade: SuggestionGrade | null | undefined; testId: string }) {
  /*
   * 🛑 NO GRADE IS "NOT GRADED" (2026-09-29) — never nothing, and never the engine's own verdict. The
   * redraft and dynasty panels printed "Verdict: accept · value 9.4" in this case.
   */
  if (!grade || !grade.graded) {
    return (
      <p data-testid={`${testId}-withheld`} className="text-amber-200/85">
        Not graded: {grade ? grade.reason : WAR_ROOM_NO_GRADE_REASON}
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
