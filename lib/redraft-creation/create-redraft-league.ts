/**
 * Single-transaction redraft league creation (League + settings + commissioner + draft + homepage + slots + draft session).
 */

import { randomUUID } from 'crypto'
import type { LeagueSport, Prisma, SoccerPipelineVariant } from '@prisma/client'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { buildInitialLeagueSettings } from '@/lib/sport-defaults/LeagueDefaultSettingsService'
import { getDraftDefaults, getWaiverDefaults } from '@/lib/sport-defaults/SportDefaultsRegistry'
import { toSportType } from '@/lib/sport-defaults/sport-type-utils'
import type { SportType } from '@/lib/sport-defaults/types'
import { getRedraftSportIntegration } from '@/lib/redraft-creation/sport-config'
import type { SoccerPipeline } from '@/lib/redraft-creation/sport-config'
import type { RedraftCreateBody } from '@/lib/redraft-creation/validate'
import { buildPostCreateLeagueHomeHref } from '@/lib/league/post-create-navigation'
import {
  getRedraftEngineDraftType,
  isFootballRedraftDefaultsSport,
  normalizeRedraftSettingsSnapshot,
} from '@/lib/league-concepts/redraftDefaults'
import { buildRedraftDraftSlotOrder } from '@/lib/redraft-core-contract'

type Tx = Prisma.TransactionClient

/**
 * Sport-specific auction budget defaults (dollars per team).
 * MLB's $260 tracks the classic 23-player rotisserie budget used by Yahoo /
 * CBS / Fantrax leagues. Other sports default to $200, matching Sleeper /
 * ESPN / Yahoo conventions for NFL, NBA, NHL, and college sports. Soccer
 * defaults low because most soccer auctions mirror FPL's £100 squad cap.
 * Commissioners can override in the draft settings panel after create.
 */
function getDefaultAuctionBudget(sport: LeagueSport): number {
  if (sport === 'MLB') return 260
  if (sport === 'SOCCER') return 100
  return 200
}

function secondsToPickTimerPreset(sec: number): string {
  const presets: [string, number][] = [
    ['30s', 30],
    ['60s', 60],
    ['90s', 90],
    ['120s', 120],
    ['300s', 300],
    ['600s', 600],
  ]
  let best = '120s'
  let bestDiff = Infinity
  for (const [k, v] of presets) {
    const d = Math.abs(v - sec)
    if (d < bestDiff) {
      bestDiff = d
      best = k
    }
  }
  return best
}

async function uniqueJoinCode(tx: Tx): Promise<string> {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  for (let attempt = 0; attempt < 12; attempt++) {
    let code = ''
    for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)]
    try {
      const clash = await tx.league.findFirst({ where: { joinCode: code }, select: { id: true } })
      if (!clash) return code
    } catch (e) {
      // Fallback: if joinCode column doesn't exist in DB yet, generate without clash check
      console.warn('[uniqueJoinCode] joinCode column query failed, using unchecked code:', (e as Error).message?.slice(0, 100))
      return code
    }
  }
  throw new Error('Unable to generate join code')
}

function resolveCoreDraftSessionType(d: RedraftCreateBody['draftType']): 'snake' | 'linear' | 'auction' {
  if (d === 'linear') return 'linear'
  if (d === 'auction') return 'auction'
  return 'snake'
}

export function soccerPipelineToPrismaVariant(
  sport: LeagueSport,
  pipeline: SoccerPipeline | null
): SoccerPipelineVariant | null {
  if (sport !== 'SOCCER' || !pipeline) return null
  return pipeline === 'mls' ? 'MLS' : 'EURO'
}

export type RedraftCreateTransactionResult = {
  leagueId: string
  homepageUrl: string
}

/** @param appUserId — Must be `AppUser.id` (app_users.id). Resolved in the API handler from the session. */
export async function createRedraftLeagueInTransaction(
  tx: Tx,
  appUserId: string,
  body: RedraftCreateBody,
  log?: (event: string, payload: Record<string, unknown>) => void
): Promise<RedraftCreateTransactionResult> {
  const sport = body.sport as LeagueSport
  const sportType = toSportType(sport) as SportType
  const draftDefaults = getDraftDefaults(sportType, undefined)
  const waiverDefaults = getWaiverDefaults(sportType, undefined)
  const soccerPipeline = (body.soccerPipeline ?? null) as SoccerPipeline | null
  const integration = getRedraftSportIntegration(sport, soccerPipeline)
  const soccerPrismaVariant = soccerPipelineToPrismaVariant(sport, soccerPipeline)
  const footballRedraft = isFootballRedraftDefaultsSport(sport)

  const coreDraft = footballRedraft ? getRedraftEngineDraftType(body.draftType) : resolveCoreDraftSessionType(body.draftType)
  const baseTimerSeconds = draftDefaults.timer_seconds_default ?? 90
  const isOffline = body.draftType === 'offline'
  const isAuto = body.draftType === 'auto'

  const initial = buildInitialLeagueSettings(sport, null)
  const requestedSettings: Record<string, unknown> = {
    ...initial,
    league_type: 'redraft',
    leagueType: 'redraft',
    sport_type: sport,
    trade_review_mode: body.tradeReviewMode,
    requested_draft_type: body.draftType,
    redraft_draft_mode: body.draftType,
    language: body.language,
    default_team_count: body.teamCount,
    soccer_pipeline: sport === 'SOCCER' ? soccerPipeline : undefined,
    redraft_creation_source: 'api_v1_redraft',
    constitution_request: {
      requestedAt: new Date().toISOString(),
      notes: '',
    },
  }
  const mergedSettings: Record<string, unknown> = footballRedraft
    ? normalizeRedraftSettingsSnapshot({
        sport,
        draftType: body.draftType,
        teamCount: body.teamCount,
        settings: requestedSettings,
      })
    : requestedSettings
  const draftSettings = (mergedSettings.draftSettings && typeof mergedSettings.draftSettings === 'object')
    ? (mergedSettings.draftSettings as Record<string, unknown>)
    : {}
  const timerSeconds = Number(draftSettings.timerSeconds ?? mergedSettings.draft_timer_seconds ?? baseTimerSeconds) || baseTimerSeconds
  const draftRounds = Number(draftSettings.rounds ?? mergedSettings.draft_rounds ?? draftDefaults.rounds_default) || draftDefaults.rounds_default
  const pickTimerPreset = secondsToPickTimerPreset(timerSeconds)

  log?.('transaction_start', { appUserId, sport })

  const joinCode = await uniqueJoinCode(tx)
  const platformLeagueId = `manual-${randomUUID()}`

  log?.('pre_prisma_league_create', {
    userIdForLeague: appUserId,
    sport,
    teamCount: body.teamCount,
    draftType: body.draftType,
  })

  const league = await tx.league.create({
    data: {
      userId: appUserId,
      isCommissioner: true,
      name: body.name.trim(),
      platform: 'manual',
      platformLeagueId,
      leagueSize: body.teamCount,
      sport,
      leagueType: 'redraft',
      leagueVariant: null,
      isDynasty: false,
      timezone: body.timezone,
      language: body.language,
      joinCode,
      status: 'active',
      settings: mergedSettings as Prisma.InputJsonValue,
      syncStatus: 'manual',
      scoring: footballRedraft ? String(mergedSettings.scoring_format ?? 'half_ppr') : null,
      scoringPresetId: footballRedraft ? String(mergedSettings.scoring_preset_id ?? 'fb_half_ppr') : null,
      rosterSize: footballRedraft ? draftRounds : null,
    },
  })

  await tx.leagueSettings.create({
    data: {
      leagueId: league.id,
      timezone: body.timezone,
      draftType: coreDraft,
      rounds: draftRounds,
      pickTimerPreset,
      pickTimerCustomValue: null,
      cpuAutoPick: true,
      aiAutoPick: isAuto,
      draftOrderMethod: 'manual',
    },
  })

  await tx.leagueWaiverSettings.create({
    data: {
      leagueId: league.id,
      waiverType: waiverDefaults.waiver_type,
      processingDayOfWeek: waiverDefaults.processing_days?.[0] ?? null,
      processingTimeUtc: waiverDefaults.processing_time_utc ?? null,
      claimLimitPerPeriod: waiverDefaults.max_claims_per_period ?? null,
      faabBudget: waiverDefaults.FAAB_budget_default ?? null,
      tiebreakRule: (waiverDefaults.claim_priority_behavior as string) ?? null,
      lockType: (waiverDefaults.game_lock_behavior as string) ?? null,
      instantFaAfterClear: waiverDefaults.free_agent_unlock_behavior === 'instant',
    },
  })

  const scoringTemplateId =
    sport === 'NFL'
      ? 'default-NFL-PPR'
      : sport === 'SOCCER'
        ? 'default-SOCCER-standard'
        : `${sport}-default`

  await tx.redraftLeagueExtendedSettings.create({
    data: {
      leagueId: league.id,
      commissionerTradeReviewType: body.tradeReviewMode,
      languageCode: body.language,
      scoringTypeDefault: String(mergedSettings.scoring_template_id ?? scoringTemplateId),
      waiverTypeDefault: waiverDefaults.waiver_type,
      rosterPresetKey: footballRedraft ? `default-${sport}-redraft-v2` : `default-${sport}-standard`,
      playoffPresetKey: footballRedraft ? 'default-redraft-v2' : 'default',
      draftTimerSecondsDefault: timerSeconds,
      isPublic: false,
      allowInviteLinks: true,
      settingsJson: toPrismaJsonInput({
        tradeReviewMode: body.tradeReviewMode,
        tradeSettings: mergedSettings.tradeSettings,
        playoffSettings: mergedSettings.playoffSettings,
      }),
    },
  })

  await tx.redraftLeagueDraftProfile.create({
    data: {
      leagueId: league.id,
      draftType: body.draftType,
      isOffline,
      isAuto,
      rounds: draftRounds,
      timerSeconds,
      orderMode: coreDraft,
      auctionBudget: body.draftType === 'auction' ? getDefaultAuctionBudget(sport) : null,
      draftStatus: isOffline ? 'offline' : 'pre_draft',
      configJson: {
        coreDraftSessionType: coreDraft,
        redraftWizard: true,
        redraftCoreContractVersion: footballRedraft ? 2 : undefined,
        mockDraftEntryAvailable: true,
        liveDraftSetupAvailable: true,
      },
    },
  })

  await tx.redraftLeagueHomepageState.create({
    data: {
      leagueId: league.id,
      activeTab: 'overview',
      onboardingComplete: false,
      chatEnabled: true,
      draftRoomEnabled: !isOffline,
      paymentEnabled: false,
      homepageConfigJson: { createdVia: 'redraft_v1' },
    },
  })

  await tx.redraftLeagueSportIntegration.create({
    data: {
      leagueId: league.id,
      sport,
      soccerPipelineVariant: soccerPrismaVariant,
      standingsEnabled: integration.standingsEnabled,
      schedulesEnabled: integration.schedulesEnabled,
      injuriesEnabled: integration.injuriesEnabled,
      newsEnabled: integration.newsEnabled,
      weatherEnabled: integration.weatherEnabled,
      playerPoolSource: integration.playerPoolSource,
      gameFeedSource: integration.gameFeedSource,
      integrationConfigJson: { source: 'redraft_v1', soccerPipeline: soccerPipeline ?? undefined },
    },
  })

  await tx.redraftLeagueChatRoom.create({
    data: {
      leagueId: league.id,
      roomType: 'league',
      title: 'League chat',
    },
  })

  const roster = await tx.roster.create({
    data: {
      leagueId: league.id,
      platformUserId: appUserId,
      playerData: { draftPicks: [] },
    },
  })

  const userProfile = await tx.userProfile.findUnique({
    where: { userId: appUserId },
    select: { displayName: true },
  })
  const displayName = userProfile?.displayName ?? 'User'

  await tx.leagueTeam.create({
    data: {
      leagueId: league.id,
      externalId: roster.id,
      ownerName: displayName,
      teamName: `${displayName}'s Team`,
      claimedByUserId: appUserId,
      platformUserId: appUserId,
      isCommissioner: true,
      role: 'commissioner',
    },
  })

  await tx.redraftLeagueMember.create({
    data: {
      leagueId: league.id,
      userId: appUserId,
      role: 'COMMISSIONER',
      teamNumber: 1,
    },
  })

  const slotData: Prisma.LeagueEntrySlotCreateManyInput[] = []
  for (let slot = 1; slot <= body.teamCount; slot++) {
    slotData.push({
      id: randomUUID(),
      leagueId: league.id,
      slotNumber: slot,
      status: 'OPEN',
      rosterId: null,
    })
  }
  await tx.leagueEntrySlot.createMany({ data: slotData })

  const draftSlotOrder = buildRedraftDraftSlotOrder({
    teamCount: body.teamCount,
    rosters: [{ id: roster.id }],
    teams: [{ ownerName: displayName, teamName: `${displayName}'s Team` }],
  })
  const auctionBudget = body.draftType === 'auction' ? getDefaultAuctionBudget(sport) : null
  await tx.draftSession.create({
    data: {
      leagueId: league.id,
      status: isOffline ? 'pre_draft' : 'pre_draft',
      draftType: coreDraft,
      rounds: draftRounds,
      teamCount: body.teamCount,
      timerSeconds,
      slotOrder: draftSlotOrder as Prisma.InputJsonValue,
      auctionBudgetPerTeam: auctionBudget,
      sportType: sport,
      sessionKind: 'live',
      cpuAutoPick: true,
      aiAutoPick: isAuto,
    },
  })

  const homepageUrl = buildPostCreateLeagueHomeHref({
    leagueId: league.id,
    leagueType: 'redraft',
    allowInviteLink: true,
  })
  log?.('transaction_success', { leagueId: league.id })

  return { leagueId: league.id, homepageUrl }
}
