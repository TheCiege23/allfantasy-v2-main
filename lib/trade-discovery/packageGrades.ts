import type { GradeInputs } from '@/lib/decision-os/trade/tradeGradeInputs'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import { gradeAllWithinBudget, type FinderGrade } from '@/lib/trade-finder/finderGrade'
import { packageGradeInputs } from '@/lib/trade-block/tradeBlockOffers'
import {
  FAIRNESS_BAND_REASON,
  fairnessFor,
  type DiscoveryWarning,
  type FairnessBand,
  type TradePackage,
} from './redraftTradeDiscovery'

/** A package after THE grade: its band, totals, flags, rank and startability are the one grader's. */
export type GradedTradePackage = Omit<TradePackage, 'myTotalValue' | 'partnerTotalValue' | 'valueDelta'> & {
  /** League value of what you send / receive on THE grade; null when the grade was withheld. */
  myTotalValue: number | null
  partnerTotalValue: number | null
  valueDelta: number | null
  /** THE grade, from your side. A withheld grade carries the grader's reason. */
  leagueGrade: FinderGrade
}

const BAND_REASONS = new Set<string>(Object.values(FAIRNESS_BAND_REASON))
/** Flags that were the finder's own value call; re-derived from THE grade below. */
const VALUE_FLAGS = new Set<DiscoveryWarning>(['LOW_DATA_CONFIDENCE', 'VALUE_GAP_HIGH'])
const BAND_RANK: Record<FairnessBand, number> = { balanced: 0, 'slight edge you': 1, 'slight edge partner': 2, 'low confidence': 3, lopsided: 4 }

/**
 * THE grade on the redraft package finder (`/api/redraft/trades/package-finder`) — 2026-11-26.
 *
 * `findPackages` still GENERATES the packages (surplus vs need, closest value per target) on the
 * discovery roster values. Until now those same values also decided every verdict the route returned:
 * `fairnessBand`, the totals and `valueDelta`, `VALUE_GAP_HIGH`, `canStartProposal` and the order.
 * Each package is now graded by the one grader (the caller closes over ONE `createLeagueTradeGrader`),
 * and every one of those is re-taken on the grade:
 *
 *   - `fairnessBand` — the same thresholds (`fairnessFor`), on the grade's league values; a withheld
 *     grade reads `low confidence` (the band this finder already uses for "could not value it"),
 *   - totals / `valueDelta` — the grade's; null when withheld,
 *   - `VALUE_GAP_HIGH` / `LOW_DATA_CONFIDENCE` — from the grade, not the finder,
 *   - `canStartProposal` — never on a withheld or lopsided grade,
 *   - the order — band, then the grade's gap.
 *
 * A withheld package is SHOWN, as `low confidence` with the reason on `leagueGrade` — the finder's
 * package is still a real idea, and dropping it would hide that the grade could not price it.
 */
export async function attachPackageGrades(args: {
  packages: readonly TradePackage[]
  grade: (give: GradeInputs, get: GradeInputs) => Promise<TradeGradeView>
  faabSupported: boolean
  sport: string
  max: number
  budgetMs: number
}): Promise<GradedTradePackage[]> {
  const grades = await gradeAllWithinBudget(
    args.packages,
    (p) => args.grade(packageGradeInputs(p.giveAssets), packageGradeInputs(p.receiveAssets)),
    args.budgetMs,
  )
  const isNcaaf = args.sport === 'NCAAF'

  const graded: GradedTradePackage[] = args.packages.map((p, i) => {
    const leagueGrade = grades[i]!
    const flags = p.warningFlags.filter((f) => !VALUE_FLAGS.has(f))
    const reasons = p.reasons.filter((r) => !BAND_REASONS.has(r))
    const hasFaab = p.giveAssets.some((a) => a.kind === 'faab' && (a.faabAmount ?? 0) > 0)
    if (!leagueGrade.graded) {
      return {
        ...p,
        myTotalValue: null,
        partnerTotalValue: null,
        valueDelta: null,
        fairnessBand: 'low confidence',
        confidence: 40,
        reasons,
        warningFlags: [...flags, 'LOW_DATA_CONFIDENCE'],
        canStartProposal: false,
        leagueGrade,
      }
    }
    const valueDelta = leagueGrade.getValue - leagueGrade.giveValue // + = you receive more
    const band = fairnessFor(valueDelta, Math.max(leagueGrade.giveValue, leagueGrade.getValue, 1), false)
    return {
      ...p,
      myTotalValue: Math.round(leagueGrade.giveValue),
      partnerTotalValue: Math.round(leagueGrade.getValue),
      valueDelta: Math.round(valueDelta),
      fairnessBand: band,
      confidence: isNcaaf ? 65 : 85,
      reasons: [...reasons, `League grade ${leagueGrade.letter} for you — ${leagueGrade.label}`],
      warningFlags: band === 'lopsided' ? [...flags, 'VALUE_GAP_HIGH'] : flags,
      canStartProposal:
        p.giveAssets.length > 0 && p.receiveAssets.length > 0 && band !== 'lopsided' && (!hasFaab || args.faabSupported),
      leagueGrade,
    }
  })

  return graded
    .sort(
      (a, b) =>
        BAND_RANK[a.fairnessBand] - BAND_RANK[b.fairnessBand] ||
        b.confidence - a.confidence ||
        Math.abs(a.valueDelta ?? Number.POSITIVE_INFINITY) - Math.abs(b.valueDelta ?? Number.POSITIVE_INFINITY),
    )
    .slice(0, Math.max(0, args.max))
}
