'use client'

import type { LegacyPackageGrade } from '@/lib/legacy/legacyPackageGrade'

/**
 * THE trade grade on an AF Legacy trade card: the one grader's letter and label, the league values
 * it was taken on, and nothing else. A withheld grade says why. See `lib/legacy/legacyPackageGrade.ts`.
 *
 * `grade` is `undefined` while the card has no answer yet (an old cached payload, a route that
 * failed) — shown as "Not graded", never as a guess.
 */
const LETTER_TONE: Record<string, string> = {
  A: 'bg-emerald-500/25 text-emerald-200 border-emerald-400/40',
  B: 'bg-cyan-500/25 text-cyan-200 border-cyan-400/40',
  C: 'bg-slate-500/25 text-slate-100 border-slate-300/30',
  D: 'bg-amber-500/25 text-amber-200 border-amber-400/40',
  F: 'bg-rose-500/25 text-rose-200 border-rose-400/40',
}

export default function LegacyOneGrade({
  grade,
  compact = false,
}: {
  grade: LegacyPackageGrade | null | undefined
  /** Letter and label only — for a card header. */
  compact?: boolean
}) {
  if (!grade || !grade.graded) {
    const why = grade && !grade.graded ? grade.reason : 'The trade grade is not available for this deal.'
    return (
      <div className="flex items-start gap-2 text-[11px] text-white/50" data-testid="legacy-one-grade-withheld">
        <span className="px-1.5 py-0.5 rounded border border-white/15 bg-white/5 font-semibold text-white/60 whitespace-nowrap">Not graded</span>
        {!compact && <span className="leading-snug">{why}</span>}
      </div>
    )
  }
  const tone = LETTER_TONE[grade.letter] ?? LETTER_TONE.C
  return (
    <div className="min-w-0" data-testid="legacy-one-grade">
      <div className="flex items-center gap-2">
        <span className={`w-7 h-7 rounded-lg border flex items-center justify-center text-sm font-black ${tone}`}>{grade.letter}</span>
        <span className="text-xs font-semibold text-white/85">{grade.label}</span>
      </div>
      {!compact && (
        <div className="mt-1 space-y-0.5">
          <div className="text-[11px] text-white/60">{grade.recommendation}</div>
          <div className="text-[11px] text-white/40">
            You send {grade.giveValue.toLocaleString()} · you get {grade.getValue.toLocaleString()} in league value · {grade.basis}
          </div>
        </div>
      )}
    </div>
  )
}
