/**
 * The legacy trade REVIEW (`/api/legacy/trade/review`), on the one trade grade. PURE: the grader is
 * injected (`createLegacyPackageGrader`), so this module never reads a league itself.
 *
 * 🛑 WHAT THIS REPLACED (2026-11-26). `buildTradeReviewData` in `lib/legacy-tool/tab-api.ts` priced
 * every player at a flat 65 and every pick at 82/58/34/22 by round, turned the difference into a
 * "fairness score", hard-coded ±8/±6/±5/±3 "team fit / short term / long term / playoff" edges off the
 * SIGN of that difference, and fused it with a Grok news sentiment into an accept/reject/counter and a
 * confidence. Two one-for-one player swaps were "even" whoever the players were. None of it was the
 * letter the analyzer gives the same deal.
 *
 * Now the deal is graded by the one grader from the reviewing side (it sends `send`, receives
 * `receive`), and every verdict field is read off that grade:
 *   - `recommendation` is the grade's own action (accept / decline → reject / counter / review → hold);
 *   - `grade`, `gradeLabel`, the league values each way and the signed gap are the grade's;
 *   - `fairnessScore` and `confidence` are NULL: the one grade has no 0–100 fairness and no confidence
 *     for a hand-typed deal, and inventing one is what this replaced;
 *   - a counter suggestion is the sub-deal it names, graded the same way;
 *   - the commissioner alert fires when the grade is A or F (one side gives up more than a quarter of
 *     the value) — and when the grade is WITHHELD, because a deal no one could price is not approved.
 * A withheld grade puts its reason in `gradeWithheld` and `reasonSummary`, never a number.
 */
import type { CommissionerAlert } from '@/lib/legacy-tool/contracts'
import type { GradeInputs } from '@/lib/decision-os/trade/tradeGradeInputs'
import type { LegacyPackageGrade } from './legacyPackageGrade'

export type ReviewAsset = {
  assetType: 'player' | 'pick'
  assetId: string
  name: string
  position?: string
  team?: string
  season?: number
  round?: number
  originalOwnerTeamId?: string
}

type GradeFn = (give: GradeInputs, get: GradeInputs) => Promise<LegacyPackageGrade>

export type ReviewRecommendation = 'accept' | 'reject' | 'counter' | 'reopen' | 'hold'

/** Review assets as one-grade input: players by name (as the analyzer sends them), picks by season and round. */
export function gradeInputsFromReviewAssets(assets: ReadonlyArray<ReviewAsset>): GradeInputs {
  const out: GradeInputs = { assets: [], unpriceable: [] }
  for (const a of assets) {
    if (a.assetType === 'pick') {
      if (a.season && a.round) out.assets.push({ kind: 'pick', year: a.season, round: a.round, ...(a.name ? { label: a.name } : {}) })
      else out.unpriceable.push(a.name?.trim() || 'a draft pick with no season or round')
      continue
    }
    const name = a.name?.trim()
    if (name) out.assets.push({ kind: 'player', name })
    else out.unpriceable.push('a player with no name')
  }
  return out
}

const ACTION_FOR_LETTER: Record<string, ReviewRecommendation> = { A: 'accept', B: 'accept', C: 'hold', D: 'counter', F: 'reject' }

export const REVIEW_NO_TRADE_REASON = 'No trade assets were supplied, so there is nothing to grade.'

export async function buildOneGradeTradeReview(args: {
  tradeId?: string
  trade?: { fromTeamId: string; toTeamId: string; send: ReviewAsset[]; receive: ReviewAsset[] }
  includeCounterSuggestions?: boolean
  includeRenegotiationAdvice?: boolean
  gradeOf: GradeFn
}) {
  const send = args.trade?.send ?? []
  const receive = args.trade?.receive ?? []
  const grade: LegacyPackageGrade =
    send.length === 0 && receive.length === 0
      ? { graded: false, reason: REVIEW_NO_TRADE_REASON }
      : await args
          .gradeOf(gradeInputsFromReviewAssets(send), gradeInputsFromReviewAssets(receive))
          .catch((): LegacyPackageGrade => ({ graded: false, reason: 'This deal could not be priced just now.' }))

  const recommendation: ReviewRecommendation = grade.graded ? ACTION_FOR_LETTER[grade.letter] ?? 'hold' : 'hold'
  const net = grade.graded ? Math.round(grade.getValue - grade.giveValue) : null

  const commissionerAlert: CommissionerAlert = !grade.graded
    ? { required: true, severity: 'medium', reason_codes: ['not_graded'] }
    : grade.letter === 'A' || grade.letter === 'F'
      ? { required: true, severity: 'medium', reason_codes: ['high_imbalance'] }
      : { required: false, severity: 'low', reason_codes: [] }

  const counterSuggestions = args.includeCounterSuggestions
    ? await Promise.all(
        [{ send: send.slice(0, 1), receive: receive.slice(0, 1) }]
          .filter((c) => c.send.length > 0 && c.receive.length > 0)
          .map(async (c) => ({
            ...c,
            grade: await args
              .gradeOf(gradeInputsFromReviewAssets(c.send), gradeInputsFromReviewAssets(c.receive))
              .catch((): LegacyPackageGrade => ({ graded: false, reason: 'This deal could not be priced just now.' })),
          })),
      )
    : null

  return {
    tradeId: args.tradeId,
    review: {
      recommendation,
      /** THE trade grade, for the reviewing side (it sends `send`). Withheld with a reason, never guessed. */
      grade,
      gradeLabel: grade.graded ? grade.label : null,
      gradeWithheld: grade.graded ? null : grade.reason,
      fairnessScore: null,
      confidence: null,
      scoreBreakdown: {
        /** League value received minus sent — the gap the letter was taken on. */
        rawValueScore: net,
        sendValue: grade.graded ? grade.giveValue : null,
        receiveValue: grade.graded ? grade.getValue : null,
      },
      reasonSummary: grade.graded
        ? [`AllFantasy trade grade: ${grade.letter} (${grade.label}) on ${grade.basis} league values.`, grade.recommendation]
        : [`Not graded: ${grade.reason}`],
      ...(counterSuggestions ? { counterSuggestions } : {}),
      ...(args.includeRenegotiationAdvice
        ? {
            renegotiationAdvice: {
              shouldReopen: grade.graded && (grade.letter === 'D' || grade.letter === 'F'),
              whyNow: grade.graded ? grade.recommendation : `Not graded: ${grade.reason}`,
              preferredAdjustments: [] as string[],
            },
          }
        : {}),
      commissionerAlert,
      gradeSource: 'one_trade_engine' as const,
    },
  }
}
