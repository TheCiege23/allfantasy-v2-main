/** Shared types for GET /api/dashboard/waivers and /trades — safe for client import. */
import type { DecisionOsActionLinks } from '@/lib/lineup-actions/types'

export type WaiverPickup = {
  playerId: string
  playerName: string
  position: string
  team: string
  addReason: string
}

export type WaiverDrop = {
  playerId: string
  playerName: string
  position: string
  team: string
}

export type WaiverLeagueRec = {
  leagueId: string
  leagueName: string
  leagueAvatar: string | null
  sport: string
  platform: string
  pickups: WaiverPickup[]
  drops: WaiverDrop[]
  chimmyAdvice: string
  /** UTC ISO for next estimated rolling waiver process when DB `League.timezone` + `waiverProcessTime` resolve; else null. */
  waiverDeadline: string | null
  /** Server-resolved internal AF + secure external source-platform action for this league (imported-league deep links). */
  actionLinks?: DecisionOsActionLinks
}

/** DB-first injury rows (importers / Rolling Insights chain); optional context for waiver UI. */
export type InjuryPulseRow = {
  sport: string
  playerName: string
  team: string
  status: string
  reportDate: string
}

export type WaiverDashboardResponse = {
  totalLeagues: number
  recommendations: WaiverLeagueRec[]
  injuryPulse?: InjuryPulseRow[]
}

export type TradeAsset = {
  playerId: string | null
  playerName: string
  position: string
  team: string
  isPick?: boolean
  pickRound?: string
}

export type PendingTrade = {
  transactionId: string
  proposedBy: string
  proposedAt: string | null
  assetsGiven: TradeAsset[]
  assetsReceived: TradeAsset[]
  chimmyVerdict: 'accept' | 'decline' | 'negotiate'
  chimmyReason: string
}

export type PendingTradeLeague = {
  leagueId: string
  leagueName: string
  leagueAvatar: string | null
  sport: string
  trades: PendingTrade[]
  /** Server-resolved internal AF + secure external source-platform action for this league (imported-league deep links). */
  actionLinks?: DecisionOsActionLinks
}

export type TradesDashboardResponse = {
  totalPending: number
  trades: PendingTradeLeague[]
}
