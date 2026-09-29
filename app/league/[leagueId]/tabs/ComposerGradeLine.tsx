'use client'

import type { SuggestionGrade } from '@/lib/trade-intel/partnerRanking'

/**
 * THE grade inside "Propose a Trade" (2026-09-28): on each suggested package, and on the deal being
 * composed. Both letters — yours first — the label, and the league values each way. A withheld grade
 * says why with no letter. See lib/league-trade-engine/proposalPackageGrades.ts.
 */
export function ComposerGradeLine({
  grade,
  partnerName,
  compact = false,
  testId = 'composer-grade',
}: {
  grade: SuggestionGrade | null | undefined
  partnerName?: string | null
  /** One line, for a package card. */
  compact?: boolean
  testId?: string
}) {
  if (!grade) return null
  if (!grade.graded) {
    return (
      <span data-testid={`${testId}-withheld`} className="mt-1 block text-[11px] leading-snug text-amber-200/80">
        Not graded: {grade.reason}
      </span>
    )
  }
  const them = partnerName?.trim() || 'Them'
  return (
    <span data-testid={testId} className="mt-1 block">
      <span className={compact ? 'text-[11px] font-semibold text-white/85' : 'text-[13px] font-bold text-white'}>
        Grade: You {grade.letter} · {them} {grade.partnerLetter}
        {grade.label ? <span className="font-normal text-white/60"> — {grade.label}</span> : null}
      </span>
      {compact ? null : (
        <span className="mt-0.5 block text-[11px] text-white/45">
          You get {Math.round(grade.getValue).toLocaleString()} for {Math.round(grade.giveValue).toLocaleString()} in league value
        </span>
      )}
    </span>
  )
}
