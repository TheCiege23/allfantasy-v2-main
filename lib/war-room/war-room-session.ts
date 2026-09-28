import { prisma } from '@/lib/prisma'
import type { SupportedSport } from '@/lib/sport-scope'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'

export type WarRoomLeagueSnapshot = {
  leagueId: string
  sport: SupportedSport
  season: number | null
  leagueType: string | null
  isDynasty: boolean
  scoring: string | null
  leagueSize: number | null
  settings: {
    aiWarRoomEnabled: boolean | null
    aiDefaultStrategyMode: string | null
    aiAggressiveness: string | null
    aiRookieBias: number | null
    aiStackPreference: string | null
    aiRiskTolerance: string | null
  } | null
}

/**
 * Resolve or create `DraftSession` (existing `draft_sessions` table) for War Room.
 */
export async function resolveWarRoomDraftSession(args: {
  leagueId: string
  sport: SupportedSport
  createIfMissing: boolean
}) {
  const existing = await prisma.draftSession.findFirst({
    where: { leagueId: args.leagueId },
    orderBy: CURRENT_DRAFT_SESSION_ORDER,
    select: {
      id: true,
      status: true,
      draftType: true,
      nextOverallPick: true,
      currentRoundNum: true,
      teamCount: true,
      rounds: true,
    },
  })
  if (existing) return existing
  if (!args.createIfMissing) return null

  return prisma.draftSession.create({
    data: {
      leagueId: args.leagueId,
      status: 'pre_draft',
      sportType: args.sport,
    },
    select: {
      id: true,
      status: true,
      draftType: true,
      nextOverallPick: true,
      currentRoundNum: true,
      teamCount: true,
      rounds: true,
    },
  })
}

export async function loadWarRoomSessionPayload(leagueId: string, userId: string, createIfMissing: boolean) {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      id: true,
      sport: true,
      season: true,
      leagueType: true,
      isDynasty: true,
      scoring: true,
      leagueSize: true,
      leagueSettings: {
        select: {
          aiWarRoomEnabled: true,
          aiDefaultStrategyMode: true,
          aiAggressiveness: true,
          aiRookieBias: true,
          aiStackPreference: true,
          aiRiskTolerance: true,
          draftType: true,
          rounds: true,
        },
      },
    },
  })
  if (!league) return null

  const sport = normalizeToSupportedSport(league.sport as SupportedSport)
  const session = await resolveWarRoomDraftSession({
    leagueId,
    sport,
    createIfMissing,
  })

  const profile = await prisma.userProfile.findUnique({
    where: { userId },
    select: {
      aiStrategyModeDefault: true,
      riskProfile: true,
      draftStyle: true,
      preferredBuild: true,
      preferredPositionsJson: true,
      fadePositionsJson: true,
    },
  })

  const leagueSnapshot: WarRoomLeagueSnapshot = {
    leagueId: league.id,
    sport,
    season: league.season ?? null,
    leagueType: league.leagueType ?? null,
    isDynasty: league.isDynasty ?? false,
    scoring: league.scoring ?? null,
    leagueSize: league.leagueSize ?? null,
    settings: league.leagueSettings
      ? {
          aiWarRoomEnabled: league.leagueSettings.aiWarRoomEnabled,
          aiDefaultStrategyMode: league.leagueSettings.aiDefaultStrategyMode,
          aiAggressiveness: league.leagueSettings.aiAggressiveness,
          aiRookieBias: league.leagueSettings.aiRookieBias,
          aiStackPreference: league.leagueSettings.aiStackPreference,
          aiRiskTolerance: league.leagueSettings.aiRiskTolerance,
        }
      : null,
  }

  return {
    leagueSnapshot,
    draftSession: session,
    userPrefs: profile,
    defaultStrategyMode:
      profile?.aiStrategyModeDefault ??
      league.leagueSettings?.aiDefaultStrategyMode ??
      'balanced',
  }
}
