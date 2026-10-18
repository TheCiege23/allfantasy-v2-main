/**
 * Post-draft report card: one manager's grade, rank, best steal, biggest reach and
 * position breakdown, built from the deterministic draft results.
 *
 * Value is `adp - overall` (positive = value, negative = reach), the same sign the
 * grader uses. Picks with no ADP match (`adpSource: 'none'`) are scored neutral by
 * the grader; they are left out of steal/reach and the value counts here so a
 * missing ADP never reads as "drafted exactly at ADP".
 */

import type { DraftResultsPayload, PickScoreEntry } from './types'

/** Below this many spots either side of ADP a pick counts as "on ADP". */
export const REPORT_CARD_EVEN_BAND = 3

export interface ReportCardPick {
  playerName: string
  position: string
  team: string | null
  round: number
  overall: number
  adp: number
  /** adp - overall, rounded to one decimal. */
  delta: number
}

export interface ReportCardPosition {
  position: string
  count: number
  /** Sum of value across this position's ADP-matched picks, one decimal. */
  value: number
}

export interface DraftReportCard {
  leagueId: string
  leagueName: string | null
  sport: string
  season: string
  rosterId: string
  displayName: string
  grade: string
  score: number
  rank: number
  teamCount: number
  pickCount: number
  /** Sum of value across ADP-matched picks, one decimal. */
  totalValue: number
  bestSteal: ReportCardPick | null
  biggestReach: ReportCardPick | null
  positions: ReportCardPosition[]
  valuePicks: number
  evenPicks: number
  reachPicks: number
  /**
   * Which ADP the card was graded against: `at_pick` when every matched pick used the
   * ADP recorded at pick time, `current` when none did, `mixed` otherwise, `none` when
   * no pick matched any ADP.
   */
  adpBasis: 'at_pick' | 'current' | 'mixed' | 'none'
}

/** One line saying which ADP the grade was measured against. */
export function adpBasisLabel(basis: DraftReportCard['adpBasis']): string {
  if (basis === 'at_pick') return 'Graded against market ADP at the moment of each pick'
  if (basis === 'mixed') return 'Graded against ADP at pick time where recorded, current ADP otherwise'
  if (basis === 'current') return 'Graded against current ADP'
  return 'No ADP matched these picks — grade reflects roster build only'
}

const round1 = (n: number) => Math.round(n * 10) / 10

function toCardPick(p: PickScoreEntry): ReportCardPick {
  return {
    playerName: p.playerName,
    position: p.position,
    team: p.team,
    round: p.round,
    overall: p.overall,
    adp: round1(p.adp),
    delta: round1(p.valueScore),
  }
}

/** Report card for `rosterId`, or null when that roster is not in the results. */
export function buildDraftReportCard(results: DraftResultsPayload, rosterId: string): DraftReportCard | null {
  const entry = results.managerRankings.find((m) => m.rosterId === rosterId)
  if (!entry) return null

  const matched = entry.picks.filter((p) => p.adpSource !== 'none')
  let bestSteal: PickScoreEntry | null = null
  let biggestReach: PickScoreEntry | null = null
  for (const p of matched) {
    if (p.valueScore > 0 && (!bestSteal || p.valueScore > bestSteal.valueScore)) bestSteal = p
    if (p.valueScore < 0 && (!biggestReach || p.valueScore < biggestReach.valueScore)) biggestReach = p
  }

  const byPosition = new Map<string, ReportCardPosition>()
  for (const p of entry.picks) {
    const position = p.position || 'OTHER'
    const row = byPosition.get(position) ?? { position, count: 0, value: 0 }
    row.count += 1
    if (p.adpSource !== 'none') row.value += p.valueScore
    byPosition.set(position, row)
  }
  const positions = [...byPosition.values()]
    .map((r) => ({ ...r, value: round1(r.value) }))
    .sort((a, b) => b.count - a.count || a.position.localeCompare(b.position))

  const atPick = matched.filter((p) => p.adpSource === 'at_pick').length
  const adpBasis: DraftReportCard['adpBasis'] =
    matched.length === 0 ? 'none' : atPick === matched.length ? 'at_pick' : atPick === 0 ? 'current' : 'mixed'

  return {
    leagueId: results.leagueId,
    leagueName: results.leagueName,
    sport: results.sport,
    season: results.season,
    rosterId,
    displayName: entry.displayName,
    grade: entry.grade,
    score: entry.score,
    rank: entry.rank,
    teamCount: results.managerRankings.length,
    pickCount: entry.pickCount,
    totalValue: round1(matched.reduce((sum, p) => sum + p.valueScore, 0)),
    bestSteal: bestSteal ? toCardPick(bestSteal) : null,
    biggestReach: biggestReach ? toCardPick(biggestReach) : null,
    positions,
    valuePicks: matched.filter((p) => p.valueScore >= REPORT_CARD_EVEN_BAND).length,
    evenPicks: matched.filter((p) => Math.abs(p.valueScore) < REPORT_CARD_EVEN_BAND).length,
    reachPicks: matched.filter((p) => p.valueScore <= -REPORT_CARD_EVEN_BAND).length,
    adpBasis,
  }
}
