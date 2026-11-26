import { withApiUsage } from "@/lib/telemetry/usage"
import { NextResponse } from 'next/server'
import { createLegacyPackageGrader, legacySessionUserId } from '@/lib/legacy/legacyOneGrade'
import { gradeInputsFromAssetLabels, type GradeInputs } from '@/lib/decision-os/trade/tradeGradeInputs'

/*
 * 🛑 THE SHARE TAB'S "TRADE VOTE" SHOWS THE ONE TRADE GRADE (2026-11-26).
 *
 * This route used to price both sides through `lib/hybrid-valuation.ts` with no league at all and
 * print its OWN letter on its own scale — "A" under a 5% gap, "B+" under 10%, … "D" past 25%, measured
 * against the SUM of both sides — so the same deal read one letter here and another in the analyzer
 * one tab away, and a lopsided deal could never be an F.
 *
 * Now both sides go to the one grader (`lib/legacy/legacyOneGrade.ts`) — typed labels read by
 * `gradeInputsFromAssetLabels`, so "2025 1st" is a pick, not a player search — graded from
 * Side A's point of view: Side A RECEIVES `side_b` and sends `side_a`, so `grade` is Side A's letter
 * and `partner_grade` Side B's mirror. The vote is about a deal in a league, and the one grade is taken
 * on a league's own values — so with no `league_id` (the Share tab sends none today) the grade is
 * WITHHELD with the same reason `/api/trade-evaluator` gives, and `verdict` says why. No number from
 * any other model stands in for it.
 */

/** One side as typed ("Ja'Marr Chase, 2025 1st"): picks and FAAB read as such, the rest as players by name. */
function sideInputs(names: unknown[]): GradeInputs {
  return gradeInputsFromAssetLabels(names.map((n) => ({ name: typeof n === 'string' ? n : '' })))
}

export const POST = withApiUsage({ endpoint: "/api/legacy/trade-vote-analyze", tool: "LegacyTradeVoteAnalyze" })(async (request: Request) => {
  try {
    const body = await request.json()
    const { side_a, side_b } = body ?? {}

    if (!Array.isArray(side_a) || !Array.isArray(side_b) || !side_a.length || !side_b.length) {
      return NextResponse.json({ error: 'Both sides must have players' }, { status: 400 })
    }

    const suppliedLeagueId =
      typeof body.league_id === 'string' ? body.league_id : typeof body.leagueId === 'string' ? body.leagueId : null
    const gradeOf = await createLegacyPackageGrader({
      suppliedLeagueId,
      userId: await legacySessionUserId(),
      viewerSide: false,
    })
    // Side A sends side_a and receives side_b.
    const grade = await gradeOf(sideInputs(side_a), sideInputs(side_b))

    if (!grade.graded) {
      return NextResponse.json({
        success: true,
        grade: null,
        partner_grade: null,
        verdict: `Not graded: ${grade.reason}`,
        gradeWithheld: grade.reason,
        side_a_value: null,
        side_b_value: null,
        diff_pct: null,
        gradeSource: 'one_trade_engine',
      })
    }

    const gapPct = (Math.abs(grade.getValue - grade.giveValue) / Math.max(grade.giveValue, grade.getValue, 1)) * 100
    return NextResponse.json({
      success: true,
      /** Side A's letter: Side A sends `side_a` and receives `side_b`. */
      grade: grade.letter,
      partner_grade: grade.partnerLetter,
      verdict: `${grade.label} for Side A. ${grade.recommendation}`,
      gradeWithheld: null,
      // League value each side SENDS — the totals the letter was taken on.
      side_a_value: grade.giveValue,
      side_b_value: grade.getValue,
      diff_pct: gapPct.toFixed(1),
      basis: grade.basis,
      gradeSource: 'one_trade_engine',
    })
  } catch (error) {
    console.error('Trade vote analyze error:', error)
    return NextResponse.json({ error: 'Failed to analyze trade' }, { status: 500 })
  }
})
