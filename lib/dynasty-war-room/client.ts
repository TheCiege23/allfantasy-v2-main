/**
 * Client helpers for the Dynasty AF War Room routes.
 * Stable wrappers so the UI never hardcodes paths. Mirrors lib/redraft-war-room/client.ts.
 */
import type { DynastyWarRoomContext } from './types'
import type { DynastyNeedsResult } from './dynastyRosterNeedsEngine'
import type { DynastyDirectionResult } from './dynastyTeamDirectionEngine'
import type { BuySellHoldResult } from './dynastyBuySellHoldEngine'
import type { DynastyLineupResult } from './dynastyLineupEngine'
import type { DynastyWaiverResult } from './dynastyWaiverEngine'
import type { DynastyTradeAnalysis, DynastyTradeFinderResult } from './dynastyTradeEngine'
/** THE grade on trade-analyze (2026-09-28, lib/decision-os/trade/warRoomTradeGrade.ts). */
import type { SuggestionGrade } from '@/lib/trade-intel/partnerRanking'

const base = (leagueId: string) => `/api/leagues/${encodeURIComponent(leagueId)}/dynasty-war-room`

async function parse<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`)
  return (body ?? {}) as T
}

export async function fetchDynastyWarRoomState(
  leagueId: string,
): Promise<{
  context: DynastyWarRoomContext
  direction: DynastyDirectionResult | null
  needs: DynastyNeedsResult | null
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

export const fetchDynastyWarRoomDirection = (leagueId: string, rosterId?: string) =>
  postAction<{ direction: DynastyDirectionResult }>(leagueId, 'team-direction', { rosterId })

export const fetchDynastyWarRoomBuySellHold = (leagueId: string, rosterId?: string) =>
  postAction<{ buySellHold: BuySellHoldResult }>(leagueId, 'buy-sell-hold', { rosterId })

export const fetchDynastyWarRoomWaivers = (leagueId: string, rosterId?: string) =>
  postAction<{ waivers: DynastyWaiverResult }>(leagueId, 'waivers', { rosterId })

export const fetchDynastyWarRoomLineup = (leagueId: string, rosterId?: string) =>
  postAction<{ lineup: DynastyLineupResult }>(leagueId, 'lineup', { rosterId })

export const analyzeDynastyWarRoomTrade = (
  leagueId: string,
  input: {
    rosterId?: string
    outgoingPlayerIds: string[]
    incomingPlayerIds: string[]
    outgoingPickIds?: string[]
    incomingPickIds?: string[]
  },
) => postAction<{ tradeAnalysis: DynastyTradeAnalysis; tradeGrade?: SuggestionGrade | null }>(leagueId, 'trade-analyze', input)

export const findDynastyWarRoomTrades = (leagueId: string, rosterId?: string) =>
  postAction<{ tradeFinder: DynastyTradeFinderResult }>(leagueId, 'trade-find', { rosterId })

export const askDynastyWarRoom = (leagueId: string, question: string, rosterId?: string) =>
  postAction<{
    answer: string | null
    aiUnavailable: boolean
    detail?: string
    grounding: unknown
  }>(leagueId, 'ask', { question, rosterId })
