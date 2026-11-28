import type { GradeInputs } from '@/lib/decision-os/trade/tradeGradeInputs'
import type { TradeGradeLine, TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import { finderGradeInputs } from './candidateGrades'
import { finderGradeOf, GRADE_FAILED, GRADE_TIMED_OUT, gradeGapPct, type FinderGrade } from './finderGrade'
import { estimateAcceptProbability, type OfferAsset, type PartnerMatch } from './partner-matchmaking'

/** A Partner Match result after THE grade: the offer's verdict and values are the one grader's. */
export type GradedPartnerMatch = Omit<PartnerMatch, 'suggestedOffer'> & {
  suggestedOffer:
    | (Omit<NonNullable<PartnerMatch['suggestedOffer']>, 'fairnessPct'> & {
        /** THE grade's value gap from your side (+ = you receive more). Null when the offer was not graded. */
        fairnessPct: number | null
        /** THE grade, from your side. A withheld grade carries its reason. */
        leagueGrade: FinderGrade
      })
    | null
  /** What the accept estimate was taken on: THE grade's gap, or partner fit alone when there was no grade. */
  acceptBasis: 'league_grade' | 'partner_fit_only'
}

/**
 * THE grade on Partner Match ("Find Best Partners", `/api/trade-finder/matchmaking`) — 2026-11-26.
 *
 * Until now the route's offer skeleton, its "Fairness" chip and its accept estimate all came from
 * `lib/hybrid-valuation.ts` values: a second engine's verdict on a surface beside the letter the
 * Trade Center shows. `findBestPartners` still GENERATES the partners and the offer (that is roster
 * fit and stays as it was); this then grades every offer with the one grader, from the viewer's side,
 * and takes every verdict from it:
 *
 *   - `suggestedOffer.leagueGrade` — the letter (or the reason it was withheld),
 *   - `suggestedOffer.fairnessPct` — the grade's own value gap, null when withheld,
 *   - each offer asset's `value` — its league value on the grade's lines, when the lines line up,
 *   - `acceptEstimate` / `acceptLabel` — re-taken on the grade's gap (partner fit alone when withheld),
 *   - the ORDER — by that canonical accept estimate, partner fit breaking ties.
 *
 * A withheld offer is SHOWN as withheld, not dropped: the partner fit is still real information, and
 * the card says why there is no letter. PURE — the grade is injected; the caller holds ONE grader.
 */
export async function gradeMatchmakingPartners(args: {
  partners: readonly PartnerMatch[]
  grade: (give: GradeInputs, get: GradeInputs) => Promise<TradeGradeView>
  /** How many to return, after the canonical re-rank. */
  maxResults: number
  budgetMs: number
}): Promise<GradedPartnerMatch[]> {
  const offers = args.partners.map((p) => p.suggestedOffer)
  const grades: Array<FinderGrade | null> = offers.map(() => null)
  const lines: Array<TradeGradeLine[] | null> = offers.map(() => null)

  let timer: ReturnType<typeof setTimeout> | undefined
  const pending = offers.map((offer, i) => {
    if (!offer) return Promise.resolve()
    grades[i] = { graded: false, reason: GRADE_TIMED_OUT }
    return Promise.resolve()
      .then(() => args.grade(finderGradeInputs(offer.userGives), finderGradeInputs(offer.partnerGives)))
      .then((view) => {
        grades[i] = finderGradeOf(view)
        if (view.graded) lines[i] = view.lines
      })
      .catch(() => {
        grades[i] = { graded: false, reason: GRADE_FAILED }
      })
  })
  await Promise.race([
    Promise.all(pending),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, args.budgetMs)
    }),
  ])
  if (timer) clearTimeout(timer)
  const settled = grades.map((g) => (g ? { ...g } : null))
  const settledLines = lines.slice()

  const graded: GradedPartnerMatch[] = args.partners.map((p, i) => {
    const grade = settled[i]
    const gap = gradeGapPct(grade)
    const { prob, label } = estimateAcceptProbability(p.matchScore, gap)
    const offer = p.suggestedOffer
    return {
      ...p,
      acceptEstimate: prob,
      acceptLabel: label,
      acceptBasis: gap == null ? 'partner_fit_only' : 'league_grade',
      suggestedOffer:
        offer && grade
          ? {
              ...offer,
              userGives: withLeagueValues(offer.userGives, settledLines[i], 'give'),
              partnerGives: withLeagueValues(offer.partnerGives, settledLines[i], 'get'),
              fairnessPct: gap == null ? null : Math.round(gap * 10) / 10,
              leagueGrade: grade,
            }
          : null,
    }
  })

  graded.sort((a, b) => b.acceptEstimate - a.acceptEstimate || b.matchScore - a.matchScore)
  return graded.slice(0, Math.max(0, args.maxResults))
}

/**
 * Each offer asset's value, as THE grade priced it. Only when the grade's lines for that side line up
 * one-for-one by name — otherwise the asset keeps no value of its own (0) rather than the finder's,
 * which would put a second engine's number on a graded card.
 */
function withLeagueValues(assets: OfferAsset[], lines: TradeGradeLine[] | null, side: 'give' | 'get'): OfferAsset[] {
  const sideLines = (lines ?? []).filter((l) => l.side === side)
  const aligned =
    sideLines.length === assets.length &&
    sideLines.every((l, i) => l.name.trim().toLowerCase() === assets[i]!.name.trim().toLowerCase())
  return assets.map((a, i) => ({ ...a, value: aligned ? Math.round(sideLines[i]!.leagueValue ?? 0) : 0 }))
}
