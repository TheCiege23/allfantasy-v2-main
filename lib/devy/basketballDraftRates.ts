/**
 * P(drafted | recruiting rank band, position) and the NBA draft slot given drafted, for college basketball —
 * the measured half of the NBA devy option (`contracts/cbbd/GAPS.md` B-02). Football's equivalent is
 * lib/devy/draftRates.generated.ts, written by scripts/devy-draft-rate-backfill.ts; this mirrors its shape.
 *
 * Here: the cell type, the bands, the minimum-n rule, the lookup, and the pure measurement and renderer that
 * scripts/basketball-devy-draft-rate-backfill.ts runs over STORED rows only. The numbers live in
 * lib/devy/basketballDraftRates.generated.ts, which is committed EMPTY until that script has real data.
 *
 * ── ⚠ WHY THE SLOT, NOT A VALUE ─────────────────────────────────────────────────────────────────────────
 * Football's E[value | drafted] is measured on the FantasyCalc NFL board, one fixed scale. The NBA grade has
 * no fixed scale: it is points over replacement under each league's own scoring (`playerDynastyValue`). So the
 * table stores WHERE drafted recruits went (the overall pick, counted), and the price is taken at grade time
 * as E[the league's own `pickDynastyValue` at that slot] — the same curve the league's picks and its ranked
 * prospects use (`nbaMeasuredProspectValue` in lib/decision-os/trade/sportDynastyValue.ts). A generated value
 * would be in no league's units.
 *
 * ── ⚠ NULL IS NOT ZERO ──────────────────────────────────────────────────────────────────────────────────
 * A missing or thin cell returns null and the deal withholds. An empty table therefore prices nobody, which is
 * the correct answer while nothing is measured.
 */
import type { BasketballPosition, StoredBasketballRecruitClass } from './cbbdRecruitsStore'
import type { StoredCbbdDraftHistory } from './cbbdDraftHistoryIngest'
import { BASKETBALL_DRAFT_RATES } from './basketballDraftRates.generated'

/** Recruiting national-rank bands, `[rankMin, rankMax)`. Fixed before measuring, so the data cannot pick them. */
export const RANK_BANDS: ReadonlyArray<readonly [number, number]> = [
  [1, 11],
  [11, 26],
  [26, 51],
  [51, 101],
  [101, 301],
]

/** Years after the class year a recruit may be drafted in: one-and-done (C+1) through a fifth year (C+5). */
export const OUTCOME_WINDOW_YEARS = [1, 2, 3, 4, 5] as const

/** A cell prices only with at least this many recruits behind P(drafted) — football's floor. */
export const BASKETBALL_MIN_RECRUITS = 50
/** ...and at least this many drafted behind the slot distribution, or E[value | drafted] rests on a handful. */
export const BASKETBALL_MIN_DRAFTED = 10

export type BasketballDraftRateCell = {
  position: BasketballPosition
  /** Inclusive lower and exclusive upper recruiting national rank. */
  rankMin: number
  rankMax: number
  /** Ranked recruits in this cell across every measured class. */
  recruits: number
  /** How many of them were drafted inside the outcome window. */
  drafted: number
  /** drafted / recruits. */
  rate: number
  /** Overall NBA pick of each drafted recruit, counted. Sums to `drafted`. */
  slots: Array<{ overall: number; count: number }>
}

export type BasketballDraftRateProvenance = {
  /** False until a completed measurement replaced the empty placeholder. */
  measured: boolean
  status: string
  recruitClasses: number[]
  draftYears: number[]
  outcomeWindowYears: number[]
  totalRecruits: number
  totalDrafted: number
  /** How well the recruit -> pick join landed. Null when nothing was measured. */
  join: { collegePicksInWindow: number; matchedToRecruit: number; matchRate: number } | null
}

/**
 * The measured cell for a prospect, or null when there is none or it is too thin. `table` is injectable for
 * tests only; production reads the generated file.
 */
export function basketballDraftRateFor(
  position: string | null | undefined,
  nationalRank: number | null | undefined,
  table: readonly BasketballDraftRateCell[] = BASKETBALL_DRAFT_RATES,
  minRecruits = BASKETBALL_MIN_RECRUITS,
  minDrafted = BASKETBALL_MIN_DRAFTED,
): BasketballDraftRateCell | null {
  const pos = String(position ?? '').trim().toUpperCase()
  if (nationalRank == null || !Number.isInteger(nationalRank) || nationalRank < 1) return null
  const hit = table.find((c) => c.position === pos && nationalRank >= c.rankMin && nationalRank < c.rankMax)
  if (!hit || hit.recruits < minRecruits || hit.drafted < minDrafted) return null
  return hit
}

export class BasketballMeasurementAbort extends Error {}

/**
 * Pure: stored recruit classes + stored draft history -> cells. Aborts rather than measuring a class whose
 * outcome window is not fully stored: a missing draft year would read as "fewer were drafted", invisibly.
 */
export function measureBasketballDraftRates(args: {
  classes: ReadonlyMap<number, StoredBasketballRecruitClass>
  drafts: ReadonlyMap<number, StoredCbbdDraftHistory>
}): { cells: BasketballDraftRateCell[]; provenance: BasketballDraftRateProvenance } {
  const classYears = [...args.classes.keys()].sort((a, b) => a - b)
  if (classYears.length === 0) throw new BasketballMeasurementAbort('no stored recruiting classes (cbbd:recruits:v1:*) — see contracts/cbbd GAPS B-04')
  const draftYears = new Set<number>()
  for (const c of classYears) {
    for (const d of OUTCOME_WINDOW_YEARS) {
      const y = c + d
      const row = args.drafts.get(y)
      if (!row || row.picks.length === 0) {
        throw new BasketballMeasurementAbort(`recruit class ${c} needs the ${y} draft, which is not stored (cbbd:draft-history:v1:${y})`)
      }
      draftYears.add(y)
    }
  }

  type Acc = { recruits: number; drafted: number; slots: Map<number, number> }
  const cells = new Map<string, Acc>()
  let totalRecruits = 0
  let totalDrafted = 0
  const recruitIds = new Set<number>()

  for (const c of classYears) {
    // Earliest pick per athlete inside this class's window.
    const pickByAthlete = new Map<number, number>()
    for (const d of OUTCOME_WINDOW_YEARS) {
      for (const p of args.drafts.get(c + d)!.picks) {
        if (!p.college || p.athleteId == null || pickByAthlete.has(p.athleteId)) continue
        pickByAthlete.set(p.athleteId, p.overall)
      }
    }
    for (const r of args.classes.get(c)!.recruits) {
      if (r.athleteId != null) recruitIds.add(r.athleteId)
      if (r.position == null || r.nationalRank == null) continue
      const band = RANK_BANDS.find(([lo, hi]) => r.nationalRank! >= lo && r.nationalRank! < hi)
      if (!band) continue
      const key = `${r.position}|${band[0]}`
      const acc = cells.get(key) ?? { recruits: 0, drafted: 0, slots: new Map<number, number>() }
      acc.recruits++
      totalRecruits++
      const overall = r.athleteId != null ? pickByAthlete.get(r.athleteId) : undefined
      if (overall != null) {
        acc.drafted++
        totalDrafted++
        acc.slots.set(overall, (acc.slots.get(overall) ?? 0) + 1)
      }
      cells.set(key, acc)
    }
  }

  // Join check: of the college picks with an athlete id in the measured draft years, how many are a stored recruit.
  let collegePicksInWindow = 0
  let matchedToRecruit = 0
  for (const y of draftYears) {
    for (const p of args.drafts.get(y)!.picks) {
      if (!p.college || p.athleteId == null) continue
      collegePicksInWindow++
      if (recruitIds.has(p.athleteId)) matchedToRecruit++
    }
  }

  const out: BasketballDraftRateCell[] = []
  for (const position of ['G', 'F', 'C'] as const) {
    for (const [rankMin, rankMax] of RANK_BANDS) {
      const acc = cells.get(`${position}|${rankMin}`)
      if (!acc) continue
      out.push({
        position, rankMin, rankMax, recruits: acc.recruits, drafted: acc.drafted,
        rate: Number((acc.drafted / acc.recruits).toFixed(6)),
        slots: [...acc.slots.entries()].sort((a, b) => a[0] - b[0]).map(([overall, count]) => ({ overall, count })),
      })
    }
  }
  return {
    cells: out,
    provenance: {
      measured: true,
      status: 'measured',
      recruitClasses: classYears,
      draftYears: [...draftYears].sort((a, b) => a - b),
      outcomeWindowYears: [...OUTCOME_WINDOW_YEARS],
      totalRecruits,
      totalDrafted,
      join: { collegePicksInWindow, matchedToRecruit, matchRate: Number((matchedToRecruit / Math.max(1, collegePicksInWindow)).toFixed(4)) },
    },
  }
}

export const EMPTY_PROVENANCE: BasketballDraftRateProvenance = {
  measured: false,
  status: 'NOT MEASURED: no basketball recruiting rows or NBA draft history are stored yet. Run the owner steps in contracts/cbbd/GAPS.md B-05, then scripts/basketball-devy-draft-rate-backfill.ts.',
  recruitClasses: [],
  draftYears: [],
  outcomeWindowYears: [...OUTCOME_WINDOW_YEARS],
  totalRecruits: 0,
  totalDrafted: 0,
  join: null,
}

/** The generated file's full text. `null` renders the committed EMPTY state. */
export function renderBasketballDraftRatesFile(measured: { cells: BasketballDraftRateCell[]; provenance: BasketballDraftRateProvenance } | null): string {
  const provenance = measured?.provenance ?? EMPTY_PROVENANCE
  const cells = measured?.cells ?? []
  const header = measured
    ? ` * Measured from stored CBBD recruiting classes ${provenance.recruitClasses.join(', ')}\n * against stored NBA drafts ${provenance.draftYears.join(', ')}.\n * Recruit -> pick join: ${provenance.join!.matchedToRecruit} of ${provenance.join!.collegePicksInWindow} college picks matched a stored recruit (${(provenance.join!.matchRate * 100).toFixed(1)}%).`
    : ` * 🛑 EMPTY ON PURPOSE — NOT MEASURED. No basketball recruiting rows are stored and no rate has been\n * measured, so every lookup returns null and every earlier-class NBA prospect withholds. Do not fill this by\n * hand. Run the steps in contracts/cbbd/GAPS.md B-05, then scripts/basketball-devy-draft-rate-backfill.ts.`
  return `/**
 * GENERATED by scripts/basketball-devy-draft-rate-backfill.ts — do not edit by hand.
 *
 * P(drafted in the NBA draft | recruiting national-rank band, position) for a college basketball recruit, and
 * the overall pick of each one drafted. Lookup and min-n rule: lib/devy/basketballDraftRates.ts.
 *
${header}
 *
 * ⚠ THIS IS "DRAFTED", NOT "FANTASY RELEVANT", and sample sizes are part of the data.
 */
import type { BasketballDraftRateCell, BasketballDraftRateProvenance } from './basketballDraftRates'

export const BASKETBALL_DRAFT_RATE_PROVENANCE: BasketballDraftRateProvenance = ${JSON.stringify(provenance, null, 2)}

export const BASKETBALL_DRAFT_RATES: BasketballDraftRateCell[] = ${JSON.stringify(cells, null, 2)}
`
}
