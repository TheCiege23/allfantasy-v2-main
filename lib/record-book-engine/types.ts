/**
 * Record Books — types for historical records (highest score, longest streak, etc.).
 * Supports NFL, NHL, NBA, MLB, NCAAB, NCAAF, SOCCER.
 */

export const RECORD_TYPES = [
  'highest_score',
  'longest_win_streak',
  'biggest_comeback',
  'most_trades_season',
  'best_draft_class',
  'most_championships',
] as const

export type RecordType = (typeof RECORD_TYPES)[number]

export const RECORD_LABELS: Record<RecordType, string> = {
  highest_score: 'Highest Score',
  longest_win_streak: 'Longest Win Streak',
  biggest_comeback: 'Biggest Comeback',
  most_trades_season: 'Most Trades (Season)',
  best_draft_class: 'Best Draft Class',
  most_championships: 'Most Championships',
}

export interface RecordCandidate {
  recordType: RecordType
  holderId: string
  value: number
  season: string
  /** Optional context for explain */
  context?: string
}

export interface RecordBookEntryView {
  recordId: string
  sport: string
  leagueId: string
  recordType: string
  recordLabel: string
  holderId: string
  value: number
  season: string
  createdAt: Date
}
