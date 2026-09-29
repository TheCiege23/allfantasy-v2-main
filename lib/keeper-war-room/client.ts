/**
 * Client helpers for the Keeper AF War Room routes.
 * Stable wrappers so the UI never hardcodes paths. Mirrors lib/redraft-war-room/client.ts.
 */
import type { KeeperWarRoomContext } from './types'
import type { KeeperRecommendationResult } from './keeperRecommendationEngine'
import type { KeeperCutListResult } from './keeperCutListEngine'
import type { KeeperNeedsResult } from './keeperRosterNeedsEngine'
import type { KeeperDraftPlanResult } from './keeperDraftPlanEngine'
import type { KeeperWaiverResult } from './keeperWaiverEngine'
import type { KeeperLineupResult } from './keeperLineupEngine'
import type { KeeperTradeAnalysis } from './keeperTradeEngine'
import type { KeeperTradeFinderResult } from './keeperTradeFinderEngine'
/** THE grade on trade-analyze (2026-09-29, lib/decision-os/trade/warRoomTradeGrade.ts). */
import type { SuggestionGrade } from '@/lib/trade-intel/partnerRanking'

const base = (leagueId: string) => `/api/leagues/${encodeURIComponent(leagueId)}/keeper-war-room`

async function parse<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`)
  return (body ?? {}) as T
}

export async function fetchKeeperWarRoomState(
  leagueId: string,
): Promise<{
  context: KeeperWarRoomContext
  recommendations: KeeperRecommendationResult | null
  needs: KeeperNeedsResult | null
}> {
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

export const fetchKeeperRecommendations = (leagueId: string, rosterId?: string) =>
  postAction<{ recommendations: KeeperRecommendationResult }>(leagueId, 'keeper-recommendations', { rosterId })

export const fetchKeeperCutList = (leagueId: string, rosterId?: string) =>
  postAction<{ cutList: KeeperCutListResult }>(leagueId, 'cut-list', { rosterId })

export const fetchKeeperDraftPlan = (leagueId: string, rosterId?: string) =>
  postAction<{ draftPlan: KeeperDraftPlanResult }>(leagueId, 'draft-plan', { rosterId })

export const fetchKeeperWaivers = (leagueId: string, rosterId?: string) =>
  postAction<{ waivers: KeeperWaiverResult }>(leagueId, 'waivers', { rosterId })

export const fetchKeeperLineup = (leagueId: string, rosterId?: string) =>
  postAction<{ lineup: KeeperLineupResult }>(leagueId, 'lineup', { rosterId })

export const analyzeKeeperWarRoomTrade = (
  leagueId: string,
  input: { rosterId?: string; outgoingPlayerIds: string[]; incomingPlayerIds: string[] },
) => postAction<{ tradeAnalysis: KeeperTradeAnalysis; tradeGrade?: SuggestionGrade | null }>(leagueId, 'trade-analyze', input)

export const findKeeperWarRoomTrades = (leagueId: string, rosterId?: string) =>
  postAction<{ tradeFinder: KeeperTradeFinderResult }>(leagueId, 'trade-find', { rosterId })

export const askKeeperWarRoom = (leagueId: string, question: string, rosterId?: string) =>
  postAction<{ answer: string | null; aiUnavailable: boolean; detail?: string; grounding: unknown }>(
    leagueId,
    'ask',
    { question, rosterId },
  )
