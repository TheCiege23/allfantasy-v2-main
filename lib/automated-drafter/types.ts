/**
 * Types for CPU and AI automated drafter (orphan/empty team picks).
 * Supports NFL, NHL, NBA, MLB, NCAAB, NCAAF, SOCCER.
 */

export type OrphanDrafterMode = 'cpu' | 'ai'

interface DrafterPlayer {
  name: string
  position: string
  team?: string | null
  adp?: number | null
  byeWeek?: number | null
}

export interface CPUDrafterInput {
  available: DrafterPlayer[]
  teamRoster: { position: string }[]
  rosterSlots?: string[]
  round: number
  slot: number
  totalTeams: number
  sport: string
  isDynasty?: boolean
  isSF?: boolean
  /** 'needs' = balance roster; 'bpa' = best available. */
  mode?: 'needs' | 'bpa'
  /** Optional: first available from queue (if configured for this roster). */
  queueFirst?: DrafterPlayer[]
  /** Optional AI-adjusted ADP by player key (consumed as data only). */
  aiAdpByKey?: Record<string, number>
  byeByKey?: Record<string, number>
}

export interface DrafterPickResult {
  player: DrafterPlayer
  reason: string
  confidence: number
  /** Which drafter produced this (for audit). */
  drafterMode: OrphanDrafterMode
  /** Optional narrative from AI drafter. */
  narrative?: string | null
}
