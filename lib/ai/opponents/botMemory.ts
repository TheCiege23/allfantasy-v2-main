/**
 * In-league bot memory — JSON blob merged server-side (`AiOpponentLeagueMemory.stateJson`).
 * Pure functions: safe to unit test without DB.
 */

import type { TeamStrategyMode } from "./types"

export type BotMemoryRosterSnapshot = {
  playerIds: string[]
  byPosition: Record<string, number>
}

export type BotLeagueMemoryState = {
  leagueId: string
  botId: string
  roster: BotMemoryRosterSnapshot
  picksOwned: string[]
  recentMoves: Array<{ type: string; summary: string; at: string }>
  recentClaims: Array<{ playerId: string; at: string }>
  tradeHistorySummaries: string[]
  positionStrength: Record<string, number>
  positionWeakness: Record<string, number>
  strategyMode: TeamStrategyMode
  targetPlayerIds: string[]
  avoidPlayerIds: string[]
  notes?: string
  updatedAtIso?: string
}

export const EMPTY_MEMORY = (leagueId: string, botId: string): BotLeagueMemoryState => ({
  leagueId,
  botId,
  roster: { playerIds: [], byPosition: {} },
  picksOwned: [],
  recentMoves: [],
  recentClaims: [],
  tradeHistorySummaries: [],
  positionStrength: {},
  positionWeakness: {},
  strategyMode: "neutral",
  targetPlayerIds: [],
  avoidPlayerIds: [],
})

export function parseMemoryJson(raw: unknown): BotLeagueMemoryState | null {
  if (!raw || typeof raw !== "object") return null
  const o = raw as Record<string, unknown>
  if (typeof o.leagueId !== "string" || typeof o.botId !== "string") return null
  return o as unknown as BotLeagueMemoryState
}

export function serializeMemory(state: BotLeagueMemoryState): Record<string, unknown> {
  return { ...state, updatedAtIso: new Date().toISOString() }
}

