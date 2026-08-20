/**
 * Concept-specific rule snapshots at league creation time.
 * Persisted under `conceptRules` inside League.settings and RedraftLeagueExtendedSettings.settingsJson.
 */

import type { Prisma } from '@prisma/client'

export type InitializeConceptRulesParams = {
  tx: Prisma.TransactionClient
  leagueId: string
  /** Format id (e.g. survivor, zombie, redraft). */
  concept: string
  sport: string
  draftType: string
  teamCount: number
  /** Optional merged settings from creation flow (reserved for future merge hints). */
  settings?: Record<string, unknown> | null
}

const SURVIVOR_ADVANTAGE_TYPES = [
  'tribal_immunity',
  'extra_vote',
  'steal_players',
  'switch_tribes',
  'block_vote',
  'cancel_vote',
  'idol_nullifier',
] as const

const SURVIVOR_EXPIRATION_TYPES = [
  'until_week',
  'until_merge',
  'until_final_users',
  'next_tribal_only',
  'single_use',
] as const

/** Maps full-league team counts to recommended tribe layout (no player assignment). */
export function survivorRecommendedTribeStructure(teamCount: number): {
  tribeCount: number
  playersPerTribe: number
} | null {
  const table: Record<number, { tribeCount: number; playersPerTribe: number }> = {
    12: { tribeCount: 3, playersPerTribe: 4 },
    15: { tribeCount: 3, playersPerTribe: 5 },
    16: { tribeCount: 4, playersPerTribe: 4 },
    20: { tribeCount: 4, playersPerTribe: 5 },
    24: { tribeCount: 4, playersPerTribe: 6 },
    28: { tribeCount: 4, playersPerTribe: 7 },
    32: { tribeCount: 4, playersPerTribe: 8 },
    40: { tribeCount: 8, playersPerTribe: 5 },
  }
  return table[teamCount] ?? null
}

/** JSON-safe snapshot only (no DB). Exported for tests. */
export function buildConceptRulesSnapshot(params: {
  concept: string
  sport: string
  draftType: string
  teamCount: number
  initializedAt?: string
}): Record<string, unknown> {
  const initializedAt = params.initializedAt ?? new Date().toISOString()
  const base = {
    concept: params.concept,
    version: 1,
    initializedAt,
    teamCount: params.teamCount,
    sport: params.sport,
    draftType: params.draftType,
  }

  switch (params.concept) {
    case 'survivor': {
      const defaultPoolPercent = 0.35
      const advantageCount = Math.round(params.teamCount * defaultPoolPercent)
      return {
        ...base,
        tribeAssignmentMode: 'random_when_full',
        commissionerCanOverrideTribes: true,
        recommendedTribeStructure: survivorRecommendedTribeStructure(params.teamCount),
        advantagePool: {
          enabled: true,
          defaultPoolPercent,
          minPoolPercent: 0.25,
          maxPoolPercent: 0.5,
          count: advantageCount,
          supportedTypes: [...SURVIVOR_ADVANTAGE_TYPES],
          expirationTypes: [...SURVIVOR_EXPIRATION_TYPES],
        },
      }
    }
    case 'zombie': {
      const whispererCount = params.teamCount < 32 ? 1 : 2
      const startingHumans = params.teamCount - whispererCount
      return {
        ...base,
        whispererSelectionTiming: 'before_draft',
        whispererPublic: true,
        declineAllowed: true,
        fallbackIfAllDecline: 'first_candidate_forced',
        whispererCount,
        startingHumans,
        infectionTrigger: 'zombie_faction_defeats_human',
        infectionEnabled: true,
        candidateOrder: [],
        assignmentStatus: 'pending',
      }
    }
    case 'big_brother':
      return {
        ...base,
        competitionStartWeek: 1,
        hohEnabled: true,
        vetoEnabled: true,
        nominationsEnabled: true,
        evictionStartWeek: 1,
        skipWeeks: [],
        doubleEliminationWeeks: [],
        commissionerCanEditSchedule: true,
      }
    case 'guillotine':
      return {
        ...base,
        eliminationStartWeek: 1,
        eliminationFrequency: 'weekly',
        teamsEliminatedPerWeek: 1,
        lowestScoreEliminated: true,
        eliminatedPlayersToWaivers: true,
      }
    case 'dynasty':
    case 'devy':
    case 'c2c':
      return {
        ...base,
        startupDraftType: 'snake',
        thirdRoundReversalAllowed: true,
        rookieDraftDefaultType: 'linear',
        rookieDraftStartsYear: 2,
        futureDraftOrderOptions: ['reverse_standings', 'max_pf', 'lottery', 'weighted_lottery'],
      }
    case 'salary_cap':
      return {
        ...base,
        defaultDraftType: 'auction',
        auctionRecommended: true,
        allowedFallbackDraftTypes: ['offline', 'auto', 'snake'],
        draftSlotContractScaleEnabled: true,
        contractValueDecreasesByPick: true,
        defaultContractYearsByRound: {
          round1: 4,
          round2: 3,
          round3: 3,
          later: 2,
        },
      }
    default:
      return { ...base }
  }
}

/**
 * Merges `conceptRules` into League.settings and RedraftLeagueExtendedSettings.settingsJson.
 * Does not remove unrelated keys.
 */
export async function initializeConceptRulesForLeague(
  params: InitializeConceptRulesParams,
): Promise<Record<string, unknown>> {
  const snapshot = buildConceptRulesSnapshot({
    concept: params.concept,
    sport: params.sport,
    draftType: params.draftType,
    teamCount: params.teamCount,
  })

  const leagueRow = await params.tx.league.findUnique({
    where: { id: params.leagueId },
    select: { settings: true },
  })
  const prevLeagueSettings = (leagueRow?.settings as Record<string, unknown> | null) ?? {}

  await params.tx.league.update({
    where: { id: params.leagueId },
    data: {
      settings: {
        ...prevLeagueSettings,
        conceptRules: snapshot,
      } as Prisma.InputJsonValue,
    },
  })

  const ext = await params.tx.redraftLeagueExtendedSettings.findUnique({
    where: { leagueId: params.leagueId },
    select: { settingsJson: true },
  })

  if (ext) {
    const prevJson = (ext.settingsJson as Record<string, unknown> | null) ?? {}
    await params.tx.redraftLeagueExtendedSettings.update({
      where: { leagueId: params.leagueId },
      data: {
        settingsJson: {
          ...prevJson,
          conceptRules: snapshot,
        } as Prisma.InputJsonValue,
      },
    })
  }

  return snapshot
}
