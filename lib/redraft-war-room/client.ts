/**
 * Client helpers for the Redraft AF War Room routes.
 * Stable wrappers so UI never hardcodes paths. Mirrors lib/redraft/client.ts style.
 */
import type { RedraftWarRoomContext } from './types'
import type { TeamNeedsResult } from './redraftTeamNeedsEngine'
import type { LineupResult } from './redraftLineupEngine'
import type { WaiverResult } from './redraftWaiverEngine'
import type { TradeAnalysis, TradeFinderResult } from './redraftTradeEngine'
/** THE grade on trade-analyze (2026-09-28, lib/decision-os/trade/warRoomTradeGrade.ts). */
import type { SuggestionGrade } from '@/lib/trade-intel/partnerRanking'
import type { WarRoomTradeAnalysisView } from '@/lib/decision-os/trade/warRoomTradeView'

const base = (leagueId: string) => `/api/leagues/${encodeURIComponent(leagueId)}/redraft-war-room`

async function parse<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`)
  return (body ?? {}) as T
}

export async function fetchRedraftWarRoomState(
  leagueId: string,
): Promise<{ context: RedraftWarRoomContext; needs: TeamNeedsResult | null }> {
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

export const fetchRedraftWarRoomWaivers = (leagueId: string, rosterId?: string) =>
  postAction<{ waivers: WaiverResult }>(leagueId, 'waivers', { rosterId })

export const fetchRedraftWarRoomLineup = (leagueId: string, rosterId?: string) =>
  postAction<{ lineup: LineupResult }>(leagueId, 'lineup', { rosterId })

export const analyzeRedraftWarRoomTrade = (
  leagueId: string,
  input: { rosterId?: string; outgoingPlayerIds: string[]; incomingPlayerIds: string[] },
) => postAction<{ tradeAnalysis: WarRoomTradeAnalysisView<TradeAnalysis>; tradeGrade?: SuggestionGrade | null }>(leagueId, 'trade-analyze', input)

export const findRedraftWarRoomTrades = (leagueId: string, rosterId?: string) =>
  postAction<{ tradeFinder: TradeFinderResult }>(leagueId, 'trade-find', { rosterId })

export const askRedraftWarRoom = (leagueId: string, question: string, rosterId?: string) =>
  postAction<{
    answer: string | null
    aiUnavailable: boolean
    detail?: string
    grounding: unknown
  }>(leagueId, 'ask', { question, rosterId })
