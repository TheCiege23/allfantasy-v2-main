import type { GradeInputs } from '@/lib/decision-os/trade/tradeGradeInputs'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import type { SuggestionGrade } from '@/lib/trade-intel/partnerRanking'
import type { SuggestedTradeAsset, SuggestedTradePackage } from './proposalSuggestions'

/**
 * THE grade on the trade composer's suggested packages, and on the deal being composed (2026-09-28).
 *
 * The league Trades tab's "Propose a Trade" composer (`ProposeTradeModal`) showed each suggested
 * package as "N% value match" — `proposalSuggestions.ts`'s own roster-value gap, a scale no other
 * trade screen uses — and the deal the manager actually built had no grade at all before it was sent.
 * Both now carry the one grade, on the viewer's side, with the inputs the Trade Center builder sends
 * (`{ playerId, name }`, `{ year, round, label }`), so a package reads the same letter here as it
 * would loaded into the builder. The grader is injected; this module stays free of the chart.
 */

export type ComposerAsset =
  | { kind: 'player'; id: string; name: string }
  | { kind: 'pick'; season: number | null; round: number | null; label: string }
  | { kind: 'faab'; amount: number }

/** One side as grader input. A pick with no season or round is NAMED as unpriceable, never priced as zero. */
export function composerGradeInputs(assets: ReadonlyArray<ComposerAsset>): GradeInputs {
  const out: GradeInputs = { assets: [], unpriceable: [] }
  for (const a of assets) {
    if (a.kind === 'player') out.assets.push({ kind: 'player', playerId: a.id, name: a.name })
    else if (a.kind === 'faab') {
      if (a.amount > 0) out.assets.push({ kind: 'faab', amount: a.amount })
    } else if (a.season != null && a.round != null) out.assets.push({ kind: 'pick', year: a.season, round: a.round, label: a.label })
    else out.unpriceable.push(a.label)
  }
  return out
}

/** A suggested package's side, in the composer's shape (picks looked up by `pickId`). */
export function composerAssetsFromPackage(
  side: ReadonlyArray<SuggestedTradeAsset>,
  picks: ReadonlyMap<string, { season: number | null; round: number | null; label: string }>,
): ComposerAsset[] {
  return side.map((a): ComposerAsset => {
    if (a.kind === 'player') return { kind: 'player', id: a.id, name: a.name }
    if (a.kind === 'faab') return { kind: 'faab', amount: a.amount ?? 0 }
    const pick = picks.get(a.id)
    return { kind: 'pick', season: pick?.season ?? null, round: pick?.round ?? null, label: pick?.label ?? a.name }
  })
}

export function suggestionGradeFrom(g: TradeGradeView): SuggestionGrade {
  return g.graded
    ? { graded: true, letter: g.letter, partnerLetter: g.partnerLetter, label: g.label, giveValue: g.giveValue, getValue: g.getValue }
    : { graded: false, reason: g.reason }
}

/**
 * Grade the packages the composer shows, in place. BOUNDED to `limit` packages across all partners
 * (grading rows nobody sees is pure cost) and FAILURE-CONTAINED: a package whose grade fails keeps
 * no letter, and the suggestions still ship.
 */
export async function gradeProposalPackages(args: {
  suggestions: ReadonlyArray<{ packages: Array<SuggestedTradePackage & { grade?: SuggestionGrade | null }> }>
  picks: ReadonlyMap<string, { season: number | null; round: number | null; label: string }>
  grade: (give: GradeInputs, get: GradeInputs) => Promise<TradeGradeView>
  limit: number
}): Promise<void> {
  const shown = args.suggestions.flatMap((s) => s.packages).slice(0, Math.max(0, args.limit))
  await Promise.all(
    shown.map(async (pkg) => {
      try {
        const g = await args.grade(
          composerGradeInputs(composerAssetsFromPackage(pkg.send, args.picks)),
          composerGradeInputs(composerAssetsFromPackage(pkg.receive, args.picks)),
        )
        pkg.grade = suggestionGradeFrom(g)
      } catch {
        pkg.grade = null
      }
    }),
  )
}
