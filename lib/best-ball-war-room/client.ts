/**
 * Client helpers for the Best Ball AF War Room routes.
 * Stable wrappers so the UI never hardcodes paths. Mirrors lib/redraft-war-room/client.ts.
 */
import type { BestBallWarRoomContext } from './types'
import type { BestBallConstructionResult } from './bestBallRosterConstructionEngine'
import type { BestBallDepthResult } from './bestBallDepthEngine'
import type { BestBallUpsideResult } from './bestBallUpsideEngine'
import type { BestBallDraftPlanResult } from './bestBallDraftPlanEngine'
import type { BestBallStackResult } from './bestBallStackCorrelationEngine'
import type { BestBallRiskResult } from './bestBallRiskEngine'
import type { BestBallWaiverResult } from './bestBallWaiverEngine'
import type { BestBallTradeAnalysis, BestBallTradeFinderResult } from './bestBallTradeEngine'
/** THE grade on trade-analyze (2026-09-29, lib/decision-os/trade/warRoomTradeGrade.ts). */
import type { SuggestionGrade } from '@/lib/trade-intel/partnerRanking'

const base = (leagueId: string) => `/api/leagues/${encodeURIComponent(leagueId)}/best-ball-war-room`

async function parse<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`)
  return (body ?? {}) as T
}

export async function fetchBestBallWarRoomState(
  leagueId: string,
): Promise<{ context: BestBallWarRoomContext; construction: BestBallConstructionResult | null; depth: BestBallDepthResult | null }> {
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

export const fetchBestBallUpside = (leagueId: string, rosterId?: string) =>
  postAction<{ upside: BestBallUpsideResult }>(leagueId, 'upside', { rosterId })

export const fetchBestBallDraftPlan = (leagueId: string, rosterId?: string) =>
  postAction<{ draftPlan: BestBallDraftPlanResult }>(leagueId, 'draft-plan', { rosterId })

export const fetchBestBallStacks = (leagueId: string, rosterId?: string) =>
  postAction<{ stacks: BestBallStackResult }>(leagueId, 'stacks', { rosterId })

export const fetchBestBallRisk = (leagueId: string, rosterId?: string) =>
  postAction<{ risk: BestBallRiskResult }>(leagueId, 'risk', { rosterId })

export const fetchBestBallWaivers = (leagueId: string, rosterId?: string) =>
  postAction<{ waivers: BestBallWaiverResult }>(leagueId, 'waivers', { rosterId })

export const analyzeBestBallWarRoomTrade = (
  leagueId: string,
  input: { rosterId?: string; outgoingPlayerIds: string[]; incomingPlayerIds: string[] },
) => postAction<{ tradeAnalysis: BestBallTradeAnalysis; tradeGrade?: SuggestionGrade | null }>(leagueId, 'trade-analyze', input)

export const findBestBallWarRoomTrades = (leagueId: string, rosterId?: string) =>
  postAction<{ tradeFinder: BestBallTradeFinderResult }>(leagueId, 'trade-find', { rosterId })

export const askBestBallWarRoom = (leagueId: string, question: string, rosterId?: string) =>
  postAction<{ answer: string | null; aiUnavailable: boolean; detail?: string; grounding: unknown }>(
    leagueId,
    'ask',
    { question, rosterId },
  )
