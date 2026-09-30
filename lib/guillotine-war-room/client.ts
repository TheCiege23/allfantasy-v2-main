/**
 * Client helpers for the Guillotine AF War Room routes.
 * Stable wrappers so the UI never hardcodes paths. Mirrors lib/redraft-war-room/client.ts.
 */
import type { GuillotineWarRoomContext } from './types'
import type { GuillotineSurvivalRiskResult } from './guillotineSurvivalRiskEngine'
import type { GuillotineRosterRiskResult } from './guillotineRosterRiskEngine'
import type { GuillotineLineupSafetyResult } from './guillotineLineupSafetyEngine'
import type { GuillotineFaabPlanResult } from './guillotineFaabEngine'
import type { GuillotineWaiverResult } from './guillotineWaiverEngine'
import type { GuillotineDroppedPlayerResult } from './guillotineDroppedPlayerEngine'
import type { GuillotineTradeAnalysis } from './guillotineTradeEngine'
import type { GuillotineWeeklyPlanResult } from './guillotineWeeklyPlanEngine'
/** THE grade on trade-analyze (2026-09-29, lib/decision-os/trade/warRoomTradeGrade.ts). */
import type { SuggestionGrade } from '@/lib/trade-intel/partnerRanking'
import type { WarRoomTradeAnalysisView } from '@/lib/decision-os/trade/warRoomTradeView'

const base = (leagueId: string) => `/api/leagues/${encodeURIComponent(leagueId)}/guillotine-war-room`

async function parse<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`)
  return (body ?? {}) as T
}

export async function fetchGuillotineWarRoomState(
  leagueId: string,
): Promise<{ context: GuillotineWarRoomContext; survival: GuillotineSurvivalRiskResult | null; weeklyPlan: GuillotineWeeklyPlanResult | null }> {
  const res = await fetch(base(leagueId), { credentials: 'include' })
  return parse(res)
}

async function postAction<T>(leagueId: string, action: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${base(leagueId)}/${action}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return parse<T>(res)
}

export const fetchGuillotineRosterRisk = (leagueId: string, rosterId?: string) =>
  postAction<{ rosterRisk: GuillotineRosterRiskResult }>(leagueId, 'roster-risk', { rosterId })

export const fetchGuillotineLineupSafety = (leagueId: string, rosterId?: string) =>
  postAction<{ lineupSafety: GuillotineLineupSafetyResult }>(leagueId, 'lineup-safety', { rosterId })

export const fetchGuillotineFaabPlan = (leagueId: string, rosterId?: string) =>
  postAction<{ faab: GuillotineFaabPlanResult }>(leagueId, 'faab-plan', { rosterId })

export const fetchGuillotineWaivers = (leagueId: string, rosterId?: string) =>
  postAction<{ waivers: GuillotineWaiverResult }>(leagueId, 'waivers', { rosterId })

export const fetchGuillotineDroppedPlayers = (leagueId: string, rosterId?: string) =>
  postAction<{ droppedPlayers: GuillotineDroppedPlayerResult }>(leagueId, 'dropped-players', { rosterId })

export const analyzeGuillotineWarRoomTrade = (
  leagueId: string,
  input: { rosterId?: string; outgoingPlayerIds: string[]; incomingPlayerIds: string[] },
) => postAction<{ tradeAnalysis: WarRoomTradeAnalysisView<GuillotineTradeAnalysis>; tradeGrade?: SuggestionGrade | null }>(leagueId, 'trade-analyze', input)

export const askGuillotineWarRoom = (leagueId: string, question: string, rosterId?: string) =>
  postAction<{ answer: string | null; aiUnavailable: boolean; detail?: string; grounding: unknown }>(
    leagueId,
    'ask',
    { question, rosterId },
  )
