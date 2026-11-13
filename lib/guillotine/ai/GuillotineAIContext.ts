/**
 * Build deterministic context for Guillotine AI prompts.
 * NO AI HERE — only data from guillotine engine and league.
 * PROMPT 334: Deterministic logic first; AI uses this for explanation/strategy only.
 */

import { buildWeeklySummary } from '../GuillotineWeeklySummaryService'
import { getGuillotineConfig } from '../GuillotineLeagueConfig'
import { getDraftSlotByRoster } from '../GuillotineWeekEvaluator'
import { prisma } from '@/lib/prisma'
import type { LeagueSport } from '@prisma/client'

type GuillotineAIContextType = 'draft' | 'survival' | 'waiver' | 'recap' | 'orphan'

export interface GuillotineAIDeterministicContext {
  leagueId: string
  sport: LeagueSport
  weekOrPeriod: number
  /** Survival standings (deterministic). */
  survivalStandings: { rosterId: string; displayName?: string; rank: number; seasonPointsCumul: number }[]
  /** Chop Zone / Danger / Safe (deterministic). */
  dangerTiers: { rosterId: string; displayName?: string; tier: string; pointsFromChopZone: number }[]
  /** Recent chop events (deterministic). */
  recentChopEvents: { weekOrPeriod: number; choppedRosterIds: string[] }[]
  /** Chopped this week (deterministic). */
  choppedThisWeek: { rosterId: string; displayName?: string }[]
  /** Config (elimination, tiebreakers, danger margin). */
  config: {
    eliminationStartWeek: number
    eliminationEndWeek: number | null
    teamsPerChop: number
    dangerMarginPoints: number | null
    tiebreakerOrder: string[]
  } | null
  /** Draft slot order (for draft strategy context). */
  draftSlotByRoster?: Record<string, number>
  /** Released player IDs from last chop (for waiver context). From event log roster_released. */
  releasedPlayerIds?: string[]
  /** Optional: roster ID for user's team (survival/start-sit context). */
  userRosterId?: string
}

/**
 * Load deterministic context for a guillotine league. Used by AI layer to ground prompts.
 */
export async function buildGuillotineAIContext(args: {
  leagueId: string
  weekOrPeriod: number
  type: GuillotineAIContextType
  userRosterId?: string
}): Promise<GuillotineAIDeterministicContext | null> {
  const { leagueId, weekOrPeriod, type, userRosterId } = args
  const summary = await buildWeeklySummary({
    leagueId,
    weekOrPeriod,
    includeDanger: true,
  })
  if (!summary) return null

  const config = await getGuillotineConfig(leagueId)
  if (!config) return null

  let draftSlotByRoster: Record<string, number> | undefined
  if (type === 'draft') {
    const slotMap = await getDraftSlotByRoster(leagueId)
    draftSlotByRoster = Object.fromEntries(slotMap)
  }

  let releasedPlayerIds: string[] | undefined
  if (type === 'waiver') {
    const events = await prisma.guillotineEventLog.findMany({
      where: { leagueId, eventType: 'roster_released' },
      orderBy: { createdAt: 'desc' },
      take: 1,
      select: { metadata: true },
    })
    const meta = events[0]?.metadata as { releasedPlayerIds?: string[] } | undefined
    releasedPlayerIds = meta?.releasedPlayerIds ?? []
  }

  return {
    leagueId,
    sport: config.sport,
    weekOrPeriod,
    survivalStandings: summary.survivalStandings,
    dangerTiers: summary.dangerTiers ?? [],
    recentChopEvents: summary.recentChopEvents,
    choppedThisWeek: summary.choppedThisWeek,
    config: config
      ? {
          eliminationStartWeek: config.eliminationStartWeek,
          eliminationEndWeek: config.eliminationEndWeek,
          teamsPerChop: config.teamsPerChop,
          dangerMarginPoints: config.dangerMarginPoints,
          tiebreakerOrder: config.tiebreakerOrder,
        }
      : null,
    draftSlotByRoster,
    releasedPlayerIds,
    userRosterId,
  }
}
