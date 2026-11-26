import type { LegacyCompletedTrade, LegacyTradeParty } from '@/lib/legacy/legacyCompletedTradeGrades'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import type { GradeLetter } from '@/lib/trade-intel/gradeScale'

/*
 * "What could I have done instead?" on the AF Legacy report card's trade cards. PURE.
 *
 * 🛑 UNTIL 2026-11-26 EVERY NUMBER AND VERDICT HERE CAME FROM `lib/hybrid-valuation.ts`: the original
 * trade's "delta" and letter were `computeDualModeTradeDelta`'s, each alternative was screened and
 * scored on `pricePlayer` / `pricePick`, and "your trade was reasonably valued" meant no hybrid swap
 * cleared +100 points — beside a trade card whose letter came from the one completed-trade grade.
 *
 * Now this module only PROPOSES the counterfactual deals (the same comparable-player and pick-package
 * lists as before: "instead of what you received, ask for X"). Every verdict is the one grade's:
 *   - `originalGrade` / `originalDelta` are the trade's own grade (its frozen original, as the card shows);
 *   - each alternative is graded by the same grader, priced the same way as a BASELINE re-grade of the
 *     actual trade (neither reads a frozen original, so the two are like for like), and
 *     `deltaImprovement` is the alternative's league-value net minus the baseline's;
 *   - an alternative is kept only when it graded, improves the net and its letter is no worse.
 * Anything the grade withholds is dropped; when the trade itself cannot be graded, the whole answer
 * is withheld with the grader's reason.
 */

export interface AlternativeOption {
  label: string
  /** League value of what the alternative receives, on the grade. */
  totalValue: number
  /** The alternative's net minus the baseline's, on the grade's league values. */
  deltaImprovement: number
  type: 'player_swap' | 'pick_package' | 'mixed'
  /** THE grade of the alternative, from your side. */
  grade: GradeLetter
}

export interface AlternativesResult {
  originalDelta: number | null
  originalGrade: GradeLetter | null
  alternatives: AlternativeOption[]
  bestAlternative: AlternativeOption | null
  /** Why no alternative could be graded; null when the comparison was made. */
  gradeWithheld: string | null
}

export type AlternativeCandidate = {
  label: string
  type: AlternativeOption['type']
  playersReceived: LegacyTradeParty['playersReceived']
  picksReceived: LegacyTradeParty['picksReceived']
}

const COMPARABLE_PLAYERS: Record<string, string[]> = {
  WR: ["Ja'Marr Chase", 'Justin Jefferson', 'Tyreek Hill', 'CeeDee Lamb', 'Davante Adams', 'Stefon Diggs', 'Chris Olave', 'Jaylen Waddle', 'AJ Brown', 'Amon-Ra St. Brown'],
  QB: ['Patrick Mahomes', 'Josh Allen', 'Joe Burrow', 'Justin Herbert', 'Lamar Jackson', 'Jalen Hurts', 'CJ Stroud', 'Dak Prescott'],
  RB: ['Jonathan Taylor', 'Christian McCaffrey', 'Saquon Barkley', 'Derrick Henry', 'Nick Chubb', 'Dalvin Cook', 'Breece Hall', 'Bijan Robinson'],
  TE: ['Travis Kelce', 'Mark Andrews', 'TJ Hockenson', 'Kyle Pitts', 'George Kittle', 'Dallas Goedert'],
}

/** At most this many comparable players per position, and this many candidates overall. */
const PER_POSITION = 6
export const MAX_CANDIDATES = 16

const LETTER_RANK: Record<GradeLetter, number> = { A: 4, B: 3, C: 2, D: 1, F: 0 }

/**
 * The counterfactual deals to grade: for each position you GAVE a player at, a comparable player at
 * that position instead of what you received; and a few pick packages from the trade's own draft
 * years. Players already in the trade are never proposed. PURE.
 */
export function alternativeCandidates(
  trade: LegacyCompletedTrade,
  isViewer: (p: LegacyTradeParty) => boolean,
): AlternativeCandidate[] {
  const me = trade.parties.find(isViewer)
  const them = trade.parties.find((p) => p !== me)
  if (!me || !them) return []
  const inTrade = new Set(
    trade.parties.flatMap((p) => p.playersReceived.map((pl) => pl.name.trim().toLowerCase())),
  )
  const out: AlternativeCandidate[] = []
  const positions = [...new Set(them.playersReceived.map((p) => String(p.position ?? '').toUpperCase()).filter(Boolean))]
  for (const pos of positions) {
    for (const name of (COMPARABLE_PLAYERS[pos] ?? []).filter((n) => !inTrade.has(n.toLowerCase())).slice(0, PER_POSITION)) {
      out.push({ label: `Trade for ${name} instead`, type: 'player_swap', playersReceived: [{ name, position: pos }], picksReceived: [] })
    }
  }
  const at = new Date(Number(trade.timestamp))
  const y = Number.isFinite(at.getTime()) ? at.getUTCFullYear() : new Date().getUTCFullYear()
  const pk = (season: number, round: number) => ({ season: String(season), round })
  const packages: Array<[string, Array<ReturnType<typeof pk>>]> = [
    [`${y} 1st`, [pk(y, 1)]],
    [`${y} 1st + 3rd`, [pk(y, 1), pk(y, 3)]],
    [`${y} 2nd + ${y + 1} 1st`, [pk(y, 2), pk(y + 1, 1)]],
    [`${y + 1} 1st + ${y + 1} 2nd`, [pk(y + 1, 1), pk(y + 1, 2)]],
    [`${y + 1} 1st + 3rd`, [pk(y + 1, 1), pk(y + 1, 3)]],
  ]
  for (const [label, picks] of packages) {
    out.push({ label: `Trade for ${label}`, type: 'pick_package', playersReceived: [], picksReceived: picks })
  }
  return out.slice(0, MAX_CANDIDATES)
}

/** The trade with the viewer receiving `received` instead — under its own id, so no frozen original matches it. */
export function tradeWithReceived(
  trade: LegacyCompletedTrade,
  isViewer: (p: LegacyTradeParty) => boolean,
  received: Pick<AlternativeCandidate, 'playersReceived' | 'picksReceived'> | null,
  idSuffix: string,
): LegacyCompletedTrade {
  return {
    ...trade,
    transactionId: `${trade.transactionId}#${idSuffix}`,
    parties: trade.parties.map((p) =>
      received && isViewer(p) ? { ...p, playersReceived: received.playersReceived, picksReceived: received.picksReceived } : p,
    ),
  }
}

const net = (v: Extract<TradeGradeView, { graded: true }>) => Math.round(v.getValue - v.giveValue)

/**
 * The alternatives, read off THE grade. `original` is the trade's own grade (the card's letter);
 * `baseline` the same trade re-graded the way the alternatives were; `graded` each candidate's grade,
 * in `candidates` order. PURE.
 */
export function rankAlternatives(
  original: TradeGradeView,
  baseline: TradeGradeView,
  candidates: ReadonlyArray<AlternativeCandidate>,
  graded: ReadonlyArray<TradeGradeView>,
): AlternativesResult {
  if (!original.graded) {
    return { originalDelta: null, originalGrade: null, alternatives: [], bestAlternative: null, gradeWithheld: original.reason }
  }
  const head = { originalDelta: net(original), originalGrade: original.letter }
  if (!baseline.graded) return { ...head, alternatives: [], bestAlternative: null, gradeWithheld: baseline.reason }
  const base = net(baseline)
  const options = candidates
    .map((c, i) => ({ c, v: graded[i] }))
    .flatMap(({ c, v }) => {
      if (!v?.graded) return []
      const improvement = net(v) - base
      if (improvement <= 0 || LETTER_RANK[v.letter] < LETTER_RANK[baseline.letter]) return []
      return [{ label: c.label, type: c.type, totalValue: Math.round(v.getValue), deltaImprovement: improvement, grade: v.letter }]
    })
    .sort((a, b) => LETTER_RANK[b.grade] - LETTER_RANK[a.grade] || b.deltaImprovement - a.deltaImprovement)
    .slice(0, 5)
  return { ...head, alternatives: options, bestAlternative: options[0] ?? null, gradeWithheld: null }
}

/** How sure the comparison is, read off the grade: a better LETTER is High, a better net alone Medium. */
export function alternativeConfidence(result: AlternativesResult, baselineLetter: GradeLetter | null): 'High' | 'Medium' | null {
  const best = result.bestAlternative
  if (!best || !baselineLetter) return null
  return LETTER_RANK[best.grade] > LETTER_RANK[baselineLetter] ? 'High' : 'Medium'
}
