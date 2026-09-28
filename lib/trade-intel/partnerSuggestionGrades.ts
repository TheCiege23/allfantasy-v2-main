import type { GradeInputs } from '@/lib/decision-os/trade/tradeGradeInputs'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import type { PartnerAsset, PartnerRanking } from './partnerRanking'

/**
 * THE grade on each suggested deal the Trade Center shows (2026-09-27).
 *
 * 🛑 THE FINDER CALLED A PACKAGE "FAIR" ON ITS OWN ROSTER-VALUE GAP (`percentApart`) — and the same
 * deal, loaded into the builder, could grade "Major overpay" (2026-09-25 field test: picks 515 vs
 * 4,818). Each shown suggestion is graded with EXACTLY the inputs the builder sends for it
 * (`toInput` in TradeCenter.tsx: `{ playerId, name }` and `{ year, round, label }`), so the card and
 * the builder read one letter.
 *
 * The grader is injected (`grade`), so this module stays free of the chart it prices on. Mutates the
 * ranking in place — it is the route's own object, about to be serialised. Never throws: a grade
 * that fails costs that card's letter, never the ranking.
 */
export async function gradePartnerSuggestions(args: {
  ranking: PartnerRanking
  /** Pick coordinates by `pickId`, from the rosters the route already holds. */
  picks: ReadonlyMap<string, { season: number | null; round: number | null; label: string }>
  grade: (give: GradeInputs, get: GradeInputs) => Promise<TradeGradeView>
  /** Only the cards the screen shows are graded — grading rows nobody sees is pure cost. */
  limit: number
}): Promise<void> {
  const inputs = (assets: PartnerAsset[]): GradeInputs => {
    const out: GradeInputs = { assets: [], unpriceable: [] }
    for (const a of assets) {
      if (a.kind === 'player') {
        out.assets.push({ kind: 'player', playerId: a.id, name: a.name })
        continue
      }
      const pick = args.picks.get(a.id)
      // A pick the builder could not rebuild (no season or round) is named, never priced as zero.
      if (pick && pick.season != null && pick.round != null) {
        out.assets.push({ kind: 'pick', year: pick.season, round: pick.round, label: pick.label })
      } else {
        out.unpriceable.push(a.name)
      }
    }
    return out
  }

  await Promise.all(
    args.ranking.partners.slice(0, args.limit).map(async (p) => {
      if (!p.suggestion) return
      try {
        const g = await args.grade(inputs(p.suggestion.give), inputs(p.suggestion.get))
        p.suggestion.grade = g.graded
          ? { graded: true, letter: g.letter, partnerLetter: g.partnerLetter, label: g.label, giveValue: g.giveValue, getValue: g.getValue }
          : { graded: false, reason: g.reason }
      } catch {
        p.suggestion.grade = null
      }
    }),
  )
}
