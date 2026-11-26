/**
 * Fairness and veto risk, READ OFF THE ONE GRADE. Pure and dependency-free apart from types.
 *
 * 🛑 WHY THIS EXISTS (2026-11-26). `/api/trade-evaluator` took its letter from the canonical grader
 * (`evaluateTrade` → `createLeagueTradeGrader`/`gradeDeal`) but kept a fairness of its own beside it:
 * `computeLineupFairness` / `computeValueFairness` (50 + tanh of its own composite totals) feeding
 * `evaluateVeto` (`lib/trade-veto.ts`, ≤52 / <55 cut-offs plus age/RB/QB heuristics). A manager could
 * be shown an "A" next to "likely veto", or a fairness number that disagreed with the value gap the
 * letter was taken on. The AI Commissioner watchlist had the same shape with ≤45 / ≤65 cut-offs.
 *
 * So there is no fairness rule here — only presentation of the grade's own numbers:
 *   - `fairnessScore` = `100 − |percentDiff|` of the grade, clamped to 0..100 — the same "N/100"
 *     readout the commissioner watchlist uses. It is SYMMETRIC: both sides of a deal read the same
 *     fairness, because the gap is divided by the larger side and the partner's percentDiff is the
 *     exact mirror.
 *   - `controversyLevel` is the letter's own band: A/F (a strong lean either way, ≥ the grader's
 *     strong band) → high, B/D (a slight lean) → medium, C (even) → low.
 *   - veto risk is that controversy, worded: high → likely to be contested, medium → a warning,
 *     low → nothing. No threshold of its own.
 *
 * ⚠ A WITHHELD GRADE WITHHOLDS ALL OF IT. No fairness number, no veto verdict, no "looks fine" —
 * `graded: false` with the grader's own reason. Ungradeable is never presented as fair or as lopsided.
 *
 * ⚠ WHICH LETTER. Under a your-team headline (`letterBasis: 'your_team'`) the headline letter is the
 * viewer's roster-adjusted one; whether a LEAGUE would contest the deal is a league-value question, so
 * these read `market` there. Everywhere else `market` is absent and the headline is league value.
 */
import type { GradeLetter } from '@/lib/trade-intel/gradeScale'
import type { TradeGradeView } from './tradeGrade'

export type GradeControversyLevel = 'high' | 'medium' | 'low' | 'unknown'

/** The letter's own band — see the header. */
export function controversyFromLetter(letter: string | null | undefined): GradeControversyLevel {
  if (letter === 'A' || letter === 'F') return 'high'
  if (letter === 'B' || letter === 'D') return 'medium'
  if (letter === 'C') return 'low'
  return 'unknown'
}

/** `100 − |percentDiff|`, rounded and clamped. Exported so every surface uses this one line. */
export function fairnessScoreFromPercentDiff(percentDiff: number): number {
  const imbalance = Math.round(Math.abs(percentDiff))
  return Math.max(0, Math.min(100, 100 - imbalance))
}

export type GradeFairness =
  | {
      graded: true
      /** 0..100, symmetric — see the header. */
      fairnessScore: number
      /** `|percentDiff|`, rounded. */
      imbalancePct: number
      /** Signed from the side that sends `give`: + means that side receives more. */
      percentDiff: number
      controversyLevel: Exclude<GradeControversyLevel, 'unknown'>
      /** The league-value letter for the `give` side, and its mirror. */
      letter: GradeLetter
      partnerLetter: GradeLetter
      withheldReason: null
    }
  | {
      graded: false
      fairnessScore: null
      imbalancePct: null
      percentDiff: null
      controversyLevel: 'unknown'
      letter: null
      partnerLetter: null
      /** The grader's own reason. */
      withheldReason: string
    }

/** The league-value reading of a grade (see "WHICH LETTER"). */
function leagueValueRead(grade: Extract<TradeGradeView, { graded: true }>): {
  letter: GradeLetter
  partnerLetter: GradeLetter
  percentDiff: number
} {
  if (grade.letterBasis === 'your_team' && grade.market) {
    return { letter: grade.market.letter, partnerLetter: grade.market.partnerLetter, percentDiff: grade.market.percentDiff }
  }
  return { letter: grade.letter, partnerLetter: grade.partnerLetter, percentDiff: grade.percentDiff }
}

export function fairnessFromGrade(grade: TradeGradeView): GradeFairness {
  if (!grade.graded) {
    return {
      graded: false,
      fairnessScore: null,
      imbalancePct: null,
      percentDiff: null,
      controversyLevel: 'unknown',
      letter: null,
      partnerLetter: null,
      withheldReason: grade.reason,
    }
  }
  const read = leagueValueRead(grade)
  const controversy = controversyFromLetter(read.letter)
  return {
    graded: true,
    fairnessScore: fairnessScoreFromPercentDiff(read.percentDiff),
    imbalancePct: Math.round(Math.abs(read.percentDiff)),
    percentDiff: read.percentDiff,
    // A graded view always carries a real letter; 'unknown' cannot happen here.
    controversyLevel: controversy === 'unknown' ? 'low' : controversy,
    letter: read.letter,
    partnerLetter: read.partnerLetter,
    withheldReason: null,
  }
}

export type GradeVetoRisk =
  | {
      assessed: true
      veto: boolean
      vetoReason: string | null
      warning: boolean
      warningText: string | null
      level: Exclude<GradeControversyLevel, 'unknown'>
      withheldReason: null
    }
  | {
      assessed: false
      veto: null
      vetoReason: null
      warning: null
      warningText: null
      level: 'unknown'
      withheldReason: string
    }

/** Veto risk is the grade's controversy band, worded. No threshold of its own. */
export function vetoRiskFromGrade(grade: TradeGradeView): GradeVetoRisk {
  const f = fairnessFromGrade(grade)
  if (!f.graded) {
    return {
      assessed: false,
      veto: null,
      vetoReason: null,
      warning: null,
      warningText: null,
      level: 'unknown',
      withheldReason: f.withheldReason,
    }
  }
  const letters = `${f.letter} / ${f.partnerLetter}`
  if (f.controversyLevel === 'high') {
    return {
      assessed: true,
      veto: true,
      vetoReason: `Grades ${letters} on this league's values (${f.imbalancePct}% value gap) — lopsided enough that a league is likely to contest it.`,
      warning: false,
      warningText: null,
      level: 'high',
      withheldReason: null,
    }
  }
  if (f.controversyLevel === 'medium') {
    return {
      assessed: true,
      veto: false,
      vetoReason: null,
      warning: true,
      warningText: `Grades ${letters} on this league's values (${f.imbalancePct}% value gap) — a slight lean; expect questions.`,
      level: 'medium',
      withheldReason: null,
    }
  }
  return {
    assessed: true,
    veto: false,
    vetoReason: null,
    warning: false,
    warningText: null,
    level: 'low',
    withheldReason: null,
  }
}
