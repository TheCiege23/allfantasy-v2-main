import type { KeeperEligibility, KeeperRecord } from '@prisma/client'

export type KeeperEligibilityRow = KeeperEligibility

export type SubmitKeeperResult = {
  valid: KeeperRecord[]
  conflicted: { playerIds: string[]; reason: string }[]
  cost: { playerId: string; costLabel: string | null; costRound: number | null }[]
  warnings: string[]
}

export type ConflictReport = {
  rosterId: string
  conflicts: { costRound: number; playerIds: string[] }[]
}[]

export type KeeperDraftPrep = {
  teamsProcessed: number
  picksForfeited: number
  playersExcluded: string[]
  summary: string
}

export type DraftOrderWithAdjustments = {
  rounds: { round: number; picks: { rosterId: string; forfeited: boolean; reason?: string }[] }[]
}

export type CarryoverResult = {
  totalKept: number
  byTeam: { teamName: string | null; keptPlayers: string[]; forfeited: string[] }[]
}

