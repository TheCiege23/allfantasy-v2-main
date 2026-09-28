import type { GradeInputs } from '@/lib/decision-os/trade/tradeGradeInputs'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import type { PricedAsset, TradeCandidate } from './candidate-generator'

/** THE grade for a finder candidate, from the viewer's side (team A). */
export type FinderCandidateGrade =
  | { graded: true; letter: 'A' | 'B' | 'C' | 'D' | 'F'; partnerLetter: 'A' | 'B' | 'C' | 'D' | 'F'; label: string; giveValue: number; getValue: number }
  | { graded: false; reason: string }

export type GradedFinderCandidate = TradeCandidate & {
  leagueGrade?: FinderCandidateGrade | null
  /** The partner's team name, from our own league rows. Absent when it could not be read. */
  partnerName?: string | null
}

/**
 * THE grade on a /trade-finder candidate (2026-09-27).
 *
 * The page labelled its cards with a scale of its own — and worse, rendered the route's
 * `opportunities` (insight notes with no assets) as trade cards, filling in "FAIR" and a fairness of
 * 80 wherever the note had none. The real trades are the `candidates`; each shown one is graded here
 * by the one grader, from team A (the viewer), with Sleeper ids qualified as Sleeper's.
 *
 * The grader is injected, so this stays free of the chart it prices on. Never throws: a failed grade
 * costs that card's letter.
 */
export async function gradeFinderCandidates(args: {
  candidates: GradedFinderCandidate[]
  grade: (give: GradeInputs, get: GradeInputs) => Promise<TradeGradeView>
  /** Only the candidates the page shows. */
  limit: number
}): Promise<void> {
  const inputs = (assets: PricedAsset[]): GradeInputs => {
    const out: GradeInputs = { assets: [], unpriceable: [] }
    for (const a of assets) {
      if (a.isPick) {
        if (a.pickYear && a.pickRound) out.assets.push({ kind: 'pick', year: a.pickYear, round: a.pickRound, label: a.name })
        else out.unpriceable.push(a.name)
      } else if (a.name?.trim()) {
        out.assets.push({ kind: 'player', name: a.name.trim(), providerIdentity: { provider: 'sleeper', id: a.assetId } })
      } else {
        out.unpriceable.push('an unnamed player')
      }
    }
    return out
  }

  await Promise.all(
    args.candidates.slice(0, args.limit).map(async (c) => {
      try {
        const g = await args.grade(inputs(c.teamA.gives), inputs(c.teamA.receives))
        c.leagueGrade = g.graded
          ? { graded: true, letter: g.letter, partnerLetter: g.partnerLetter, label: g.label, giveValue: g.giveValue, getValue: g.getValue }
          : { graded: false, reason: g.reason }
      } catch {
        c.leagueGrade = null
      }
    }),
  )
}
