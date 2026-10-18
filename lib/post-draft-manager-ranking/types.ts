/**
 * Post-draft manager ranking types (PROMPT 231).
 * Deterministic scoring; supports NFL, NHL, NBA, MLB, NCAAB, NCAAF, Soccer.
 */

export interface PickScoreEntry {
  id: string
  overall: number
  round: number
  slot: number
  rosterId: string
  displayName: string | null
  playerName: string
  position: string
  team: string | null
  byeWeek: number | null
  /** ADP used (from AI ADP or fallback). */
  adp: number
  /**
   * Where `adp` came from: `at_pick` = market ADP recorded when the pick was made,
   * `current` = today's AI ADP for the format, `none` = no match (adp = overall, neutral).
   */
  adpSource?: 'at_pick' | 'current' | 'none'
  /** value_score = adp - actual_pick (positive = value, negative = reach). */
  valueScore: number
}

export interface ManagerRankingEntry {
  rank: number
  rosterId: string
  displayName: string
  slot: number
  grade: string
  score: number
  /** Sum of pick value_score (ADP - actual_pick). */
  totalValueScore: number
  /** Positional starter coverage across core positions. */
  positionalScore: number
  /** Positional depth quality (multi-layer depth in key positions). */
  positionalDepthScore: number
  /** Bench value quality from late-round picks. */
  benchScore: number
  /** Roster consistency / structural balance. */
  balanceScore: number
  /** Late-round upside and growth profile score. */
  upsideScore: number
  /** Reach control score (penalizes negative value picks). */
  reachPenaltyScore: number
  /** Lower injury-risk profile yields higher score. */
  injuryRiskScore: number
  /** Lower bye-week overlap yields higher score. */
  byeWeekScore: number
  pickCount: number
  picks: PickScoreEntry[]
  /** Best value pick (max valueScore). */
  bestPick: PickScoreEntry | null
  /** Worst reach (min valueScore). */
  worstReach: PickScoreEntry | null
  /** Deterministic by default; optional AI rewrite when requested. */
  explanation?: string | null
  explanationSource?: 'deterministic' | 'ai'
}

export interface DraftResultsPayload {
  leagueId: string
  leagueName: string | null
  sport: string
  draftType: string
  season: string
  status: string
  rounds: number
  teamCount: number
  totalPicks: number
  /** Draft board recap: all picks in order. */
  pickLog: Array<{
    id: string
    overall: number
    round: number
    slot: number
    rosterId: string
    displayName: string | null
    playerName: string
    position: string
    team: string | null
    valueScore?: number
    adp?: number
  }>
  /** Managers ranked 1st best draft to last. */
  managerRankings: ManagerRankingEntry[]
  /** Indicates whether AI explanation generation was requested and returned. */
  aiExplanationEnabled?: boolean
  /** Best single pick in the draft (max valueScore across all picks). */
  bestPickOfDraft: PickScoreEntry | null
  /** Worst reach in the draft (min valueScore). */
  worstReachOfDraft: PickScoreEntry | null
  /** Steal of the draft (same as bestPickOfDraft or highlight). */
  stealOfDraft: PickScoreEntry | null
}

export const LETTER_GRADES = ['A+', 'A', 'A-', 'B+', 'B', 'C', 'D'] as const
export type LetterGrade = (typeof LETTER_GRADES)[number]
