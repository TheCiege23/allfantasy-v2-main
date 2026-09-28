'use client'

import type { DraftPickTradeGrade } from '@/lib/live-draft-engine/draftPickTradeGrade'

/**
 * THE grade on the live-draft pick-trade builder (2026-09-28) — see
 * lib/live-draft-engine/draftPickTradeGrade.ts. Graded: both letters, the label and the league values.
 * Not graded: why, with no letter.
 */
export function readDraftPickTradeGrade(raw: unknown): DraftPickTradeGrade | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const g = raw as Record<string, unknown>
  if (g.graded === true && typeof g.letter === 'string' && typeof g.partnerLetter === 'string') {
    return {
      graded: true,
      letter: g.letter,
      partnerLetter: g.partnerLetter,
      label: typeof g.label === 'string' ? g.label : '',
      giveValue: typeof g.giveValue === 'number' ? g.giveValue : 0,
      getValue: typeof g.getValue === 'number' ? g.getValue : 0,
      recommendation: typeof g.recommendation === 'string' ? g.recommendation : '',
    }
  }
  if (g.graded === false && typeof g.reason === 'string' && g.reason.trim()) return { graded: false, reason: g.reason.trim() }
  return null
}

export function DraftPickTradeGradeLine({
  grade,
  partnerName,
}: {
  grade: DraftPickTradeGrade | null | undefined
  partnerName?: string | null
}) {
  if (!grade) return null
  if (!grade.graded) {
    return (
      <p data-testid="draft-trade-grade-withheld" className="mb-3 text-[12px] leading-snug text-amber-200/90">
        Not graded: {grade.reason}
      </p>
    )
  }
  return (
    <div data-testid="draft-trade-grade" className="mb-3">
      <p className="text-[14px] font-bold text-white">
        League grade: You {grade.letter} · {partnerName?.trim() || 'Them'} {grade.partnerLetter}
        {grade.label ? <span className="font-semibold text-white/65"> — {grade.label}</span> : null}
      </p>
      <p className="mt-0.5 text-[11px] text-white/45">
        You get {Math.round(grade.getValue).toLocaleString()} for {Math.round(grade.giveValue).toLocaleString()} in league value
      </p>
    </div>
  )
}
