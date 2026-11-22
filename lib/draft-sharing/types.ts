/**
 * Draft Results Sharing (PROMPT 294) — types for draft share cards and API.
 */

export type DraftShareVariant = 'draft_grade' | 'draft_rankings' | 'draft_winner'

export interface DraftGradeRow {
  rosterId: string
  name?: string
  grade: string
  score: number
}

interface DraftSharePayloadBase {
  leagueId: string
  leagueName: string
  season: string
}

/** Single team draft grade card (reuse AI insight card draft_grade shape). */
export interface DraftGradeCardPayload extends DraftSharePayloadBase {
  variant: 'draft_grade'
  teamName: string
  rosterId: string
  grade: string
  score: number
  insight: string
  highlights?: string[]
  rank?: number
}

/** Full team rankings card (list). */
export interface DraftRankingsCardPayload extends DraftSharePayloadBase {
  variant: 'draft_rankings'
  grades: DraftGradeRow[]
}

/** Winner of draft card. */
export interface DraftWinnerCardPayload extends DraftSharePayloadBase {
  variant: 'draft_winner'
  winnerName: string
  winnerRosterId: string
  grade: string
  score: number
  insight: string
  /** Runner-up or "Best value" etc. */
  blurb?: string
}

export type DraftShareCardPayload =
  | DraftGradeCardPayload
  | DraftRankingsCardPayload
  | DraftWinnerCardPayload
