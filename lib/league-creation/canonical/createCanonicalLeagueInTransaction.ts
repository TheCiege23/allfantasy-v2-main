/**
 * Single-transaction canonical league creation (concept-first preset pipeline).
 * Mirrors redraft shell: League + settings + commissioner + draft + homepage + slots + draft session.
 */

import { randomUUID } from 'crypto'
import type { LeagueFormatId } from '@/lib/league/format-engine'
import { Prisma } from '@prisma/client'
import type { LeagueSport } from '@prisma/client'
import { SETTINGS_SNAPSHOT_VERSION } from '@/lib/league-contract/types'
import { buildPostCreateLeagueHomeHref } from '@/lib/league/post-create-navigation'
import { getRedraftSportIntegration } from '@/lib/redraft-creation/sport-config'
import type { SoccerPipeline } from '@/lib/redraft-creation/sport-config'
import { soccerPipelineToPrismaVariant } from '@/lib/redraft-creation/create-redraft-league'
import { getGuillotineSportConfig } from '@/lib/guillotine/sportConfig'
import type { PresetEngineOutput } from '@/lib/league-creation/canonical/types'
import type { ValidatedCreateLeagueBody } from '@/lib/league-creation/canonical/validateCreateLeague'
import { mapCanonicalDraftTypeToEngineCore } from '@/lib/draft-types/draftTypeRegistry'
import { mapKeeperCreationFromWizard } from '@/lib/keeper/mapKeeperCreationFromWizard'
import { supportsIdpLeagueSport } from '@/lib/sport-scope'
import { normalizeBestBallSettings } from '@/lib/bestball/rules'
import { getLeagueDefaults as getFoundationLeagueDefaults } from '@/lib/league-defaults/getLeagueDefaults'

type Tx = Prisma.TransactionClient

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
      console.warn('[uniqueJoinCode:canonical] joinCode query failed:', (e as Error).message?.slice(0, 100))
      return code
    }
  }
  throw new Error('Unable to generate join code')
}

function leagueModeColumns(formatId: LeagueFormatId): Partial<Prisma.LeagueUncheckedCreateInput> {
  return {
    isDynasty: formatId === 'dynasty' || formatId === 'devy' || formatId === 'c2c' || formatId === 'salary_cap',
    bestBallMode: formatId === 'best_ball',
    guillotineMode: formatId === 'guillotine',
    survivorMode: formatId === 'survivor',
  }
}

function resolvePreferredManagerName(input: {
  username?: string | null
  displayName?: string | null
  email?: string | null
}): string {
  const username = input.username?.trim()
  if (username) return username

  const displayName = input.displayName?.trim()
  if (displayName) return displayName

  return 'AllFantasy Manager'
}

function readNumber(
  source: Record<string, unknown> | null | undefined,
  key: string,
  fallback: number
): number {
  const value = source?.[key]
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function readString(
  source: Record<string, unknown> | null | undefined,
  key: string,
  fallback: string
): string {
  const value = source?.[key]
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback
}

/**
 * Unlike `readNumber`, preserves an absent value as `null` rather than a fallback number.
 * `League.rosterSize` is a nullable column precisely so "we don't know" can be recorded honestly
 * instead of as a guessed default that reads as a real, commissioner-set roster size.
 */
function readNullableNumber(
  source: Record<string, unknown> | null | undefined,
  key: string,
): number | null {
  const value = source?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function buildOpenTeamName(slotNumber: number): string {
  return `Open Team ${slotNumber}`
}

export type CanonicalCreateTransactionResult = {
  leagueId: string
  homepageUrl: string
  inviteUrl: string
}

export async function createCanonicalLeagueInTransaction(
  tx: Tx,
  appUserId: string,
  body: ValidatedCreateLeagueBody,
  engine: PresetEngineOutput,
  log?: (event: string, payload: Record<string, unknown>) => void
): Promise<CanonicalCreateTransactionResult> {
  const sport = body.sport as LeagueSport
  const soccerPipeline = (body.soccerPipeline ?? null) as SoccerPipeline | null
  const integration = getRedraftSportIntegration(sport, soccerPipeline)
  const soccerPrismaVariant = soccerPipelineToPrismaVariant(sport, soccerPipeline)

  const resolution = engine.formatResolution
  const formatId = engine.leagueFormatId as LeagueFormatId
  const draftDefaults = resolution.draftDefaults
  const waiverDefaults = resolution.waiverDefaults as {
    waiver_type: string
    processing_days?: number[]
    processing_time_utc?: string | null
    max_claims_per_period?: number | null
    FAAB_budget_default?: number | null
    claim_priority_behavior?: string
    game_lock_behavior?: string
    free_agent_unlock_behavior?: string
  }

  const coreDraft = mapCanonicalDraftTypeToEngineCore(body.draftType)
  const isOffline = body.draftType.toLowerCase() === 'offline'
  const isAuto = body.draftType.toLowerCase() === 'auto'
  const bestBallSettings =
    formatId === 'best_ball'
      ? normalizeBestBallSettings({
          sport,
          conceptSetup: (body.conceptSetup ?? null) as Record<string, unknown> | null,
          draftType: body.draftType,
          timezone: body.timezone ?? null,
          language: body.language ?? null,
        })
      : null
  const foundationDefaults = getFoundationLeagueDefaults({
    sport,
    format: formatId,
    draftType: body.draftType,
    managerCount: body.teamCount,
    scoringPreset: body.scoringPreset,
  })
  const managerCount = foundationDefaults.managerCount
  const draftSettings = foundationDefaults.draftSettings
  const draftRounds = readNumber(draftSettings, 'rounds', draftDefaults.rounds_default)
  const timerSeconds = readNumber(draftSettings, 'timerSeconds', draftDefaults.timer_seconds_default ?? 90)
  const pickTimerPreset = secondsToPickTimerPreset(timerSeconds)

  const tradeReview =
    bestBallSettings && !bestBallSettings.tradesEnabled
      ? 'none'
      : body.tradeReviewMode === 'none' || body.tradeReviewMode == null
      ? 'commissioner'
      : body.tradeReviewMode

  log?.('canonical_transaction_start', { appUserId, sport, formatId })

  const [userProfile, appUser] = await Promise.all([
    tx.userProfile.findUnique({
      where: { userId: appUserId },
      select: { displayName: true, xpLevel: true, legacyCareerLevel: true },
    }),
    tx.appUser.findUnique({
      where: { id: appUserId },
      select: { username: true, email: true },
    }),
  ])

  const managerName = resolvePreferredManagerName({
    username: appUser?.username,
    displayName: userProfile?.displayName,
    email: appUser?.email,
  })
  const creatorRankLevelRaw = Number(userProfile?.xpLevel ?? userProfile?.legacyCareerLevel ?? 1)
  const creatorRankLevel = Number.isFinite(creatorRankLevelRaw) ? Math.max(1, Math.floor(creatorRankLevelRaw)) : 1
  const minRankLevel = Math.max(1, creatorRankLevel - 3)
  const maxRankLevel = creatorRankLevel + 3

  const mergedSettings: Record<string, unknown> = {
    ...engine.settingsSnapshot,
    league_type: formatId,
    leagueType: formatId,
    sport_type: sport,
    trade_review_mode: tradeReview,
    requested_draft_type: body.draftType,
    canonical_draft_mode: body.draftType,
    language: body.language ?? 'en',
    default_team_count: managerCount,
    foundation_defaults: {
      roster: foundationDefaults.rosterSettings,
      scoring: foundationDefaults.scoringSettings,
      draft: foundationDefaults.draftSettings,
      waiver: foundationDefaults.waiverSettings,
      playoff: foundationDefaults.playoffSettings,
      schedule: foundationDefaults.scheduleSettings,
      redraftContract: foundationDefaults.redraftContract ?? undefined,
      keeperContract: foundationDefaults.keeperContract ?? undefined,
      devyContract: foundationDefaults.devyContract ?? undefined,
      keeperPolicy: foundationDefaults.keeperPolicy ?? undefined,
      devySettings: foundationDefaults.devySettings ?? undefined,
      devyConfig: foundationDefaults.devyConfig ?? undefined,
      playerPoolRules: foundationDefaults.playerPoolRules ?? undefined,
      proPlayerPoolRules: foundationDefaults.proPlayerPoolRules ?? undefined,
      devyPlayerPoolRules: foundationDefaults.devyPlayerPoolRules ?? undefined,
      rookiePlayerPoolRules: foundationDefaults.rookiePlayerPoolRules ?? undefined,
      tabsEnabled: foundationDefaults.tabsEnabled ?? undefined,
      mockDraftRules: foundationDefaults.mockDraftRules ?? undefined,
      liveDraftRules: foundationDefaults.liveDraftRules ?? undefined,
      tradeSettings: foundationDefaults.tradeSettings ?? undefined,
      conceptPreset: foundationDefaults.conceptPreset,
    },
    soccer_pipeline: sport === 'SOCCER' ? soccerPipeline : undefined,
    canonical_creation_source: 'post_api_leagues_v1',
    constitution_request: {
      requestedAt: new Date().toISOString(),
      notes: '',
    },
    best_ball_settings: bestBallSettings ?? undefined,
    league_finder_rank_window: {
      creatorRankLevel,
      minRankLevel,
      maxRankLevel,
    },
  }

  const keeperBootstrap =
    formatId === 'keeper'
      ? mapKeeperCreationFromWizard({
          draftType: body.draftType,
          settings: mergedSettings,
          conceptSetup: (body.conceptSetup ?? null) as Record<string, unknown> | null,
        })
      : null
  if (keeperBootstrap) {
    mergedSettings.keeper_policy_snapshot = {
      maxKeepers: keeperBootstrap.draftKeeperConfig.maxKeepers,
      deadline: keeperBootstrap.draftKeeperConfig.deadline ?? null,
      maxKeepersPerPosition: keeperBootstrap.draftKeeperConfig.maxKeepersPerPosition ?? null,
    }
  }

  const joinCode = await uniqueJoinCode(tx)
  const platformLeagueId = `manual-${randomUUID()}`
  /** Calendar season year for list badges / filters (must not rely on Prisma's static default). */
  const seasonYear = new Date().getFullYear()

  const isGuillotine = formatId === 'guillotine'
  const guillotineProfile = isGuillotine ? getGuillotineSportConfig(sport) : undefined
  const guillotineDefaultWaiverDelayHours = guillotineProfile?.dailyGames ? 48 : 24
  const scoringSettings = foundationDefaults.scoringSettings
  const playoffSettings = foundationDefaults.playoffSettings
  const scoringFormat = String(
    scoringSettings.scoringFormat ?? scoringSettings.preset ?? body.scoringPreset ?? 'standard',
  )
  const scoringMode = String(scoringSettings.scoringMode ?? 'points')
  const playoffTeamsDefault = readNumber(playoffSettings, 'playoffTeams', isGuillotine ? 1 : 6)
  const playoffStartWeekRaw = playoffSettings.playoffStartWeek
  const playoffStartWeekDefault =
    playoffStartWeekRaw == null ? null : Number.isFinite(Number(playoffStartWeekRaw)) ? Number(playoffStartWeekRaw) : null
  const playoffWeeksPerRoundDefault = readNumber(playoffSettings, 'playoffWeeksPerRound', 1)
  const playoffSeedingRuleDefault = readString(playoffSettings, 'seedingRule', 'record_then_points')
  const playoffLowerBracketDefault = readString(playoffSettings, 'lowerBracket', 'consolation')

  const league = await tx.league.create({
    data: {
      userId: appUserId,
      isCommissioner: true,
      name: body.leagueName.trim(),
      platform: 'manual',
      platformLeagueId,
      season: seasonYear,
      leagueSize: managerCount,
      sport,
      leagueType: formatId,
      leagueVariant: resolution.modifiers.includes('idp') && supportsIdpLeagueSport(sport) ? 'idp' : null,
      timezone: body.timezone ?? 'America/New_York',
      language: body.language ?? 'en',
      joinCode,
      status: 'setup',
      lifecycleState: 'setup',
      settings: mergedSettings as Prisma.InputJsonValue,
      syncStatus: 'manual',
      scoring: scoringFormat,
      /**
       * ⚠ THE OLD LOOKUP HERE COULD NEVER SUCCEED. It read `roster_size` / `rosterSize` off
       * rosterSettings, but no producer under lib/league-defaults or lib/league-concepts has ever
       * written either key — `getLeagueDefaults` resolves `rosterSlots` / `benchSlots` / `irSlots`
       * / `taxiSlots` individually and never summed them. Every call missed both keys, the
       * `readNumber` fallback of 0 was then collapsed by `|| null`, and this column was written
       * NULL on every manual-league creation with no error anywhere to say so.
       *
       * `totalRosterSlots` is the sum getLeagueDefaults now computes from those same resolved
       * slot counts (see the comment there). Still nullable on purpose: a concept whose preset
       * carries no roster-slot data at all should record "unknown", not a guessed 0.
       */
      rosterSize: readNullableNumber(foundationDefaults.rosterSettings, 'totalRosterSlots'),
      presetKey: engine.presetKey,
      scoringPresetId: body.scoringPreset,
      settingsSnapshotVersion: SETTINGS_SNAPSHOT_VERSION,
      bestBallVariant:
        bestBallSettings == null
          ? undefined
          : bestBallSettings.contestStructure === 'tournament'
            ? 'tournament'
            : 'standard',
      bbWaiversEnabled: bestBallSettings?.waiversEnabled,
      bbTradesEnabled: bestBallSettings?.tradesEnabled,
      bbFaEnabled: bestBallSettings?.waiversEnabled,
      bbIrEnabled: false,
      bbTaxiEnabled: false,
      bbScoringPeriod: bestBallSettings?.scoringPeriod,
      bbMatchupFormat: bestBallSettings?.matchupFormat,
      bbTiebreaker: bestBallSettings?.tieRule,
      bbOptimizerTiming: 'period_end',
      playoffTeams: bestBallSettings?.playoffTeams ?? playoffTeamsDefault,
      playoffSeedingRule:
        bestBallSettings?.matchupFormat === 'cumulative'
          ? 'points_only'
          : bestBallSettings?.playoffFormat === 'advancement'
            ? 'points_only'
            : playoffSeedingRuleDefault,
      playoffStartWeek:
        bestBallSettings && bestBallSettings.playoffTeams > 0
          ? bestBallSettings.regularSeasonLength + 1
          : playoffStartWeekDefault,
      playoffWeeksPerRound:
        bestBallSettings && bestBallSettings.playoffTeams > 0 && bestBallSettings.playoffFormat !== 'none'
          ? 1
          : playoffWeeksPerRoundDefault,
      playoffLowerBracket: playoffLowerBracketDefault,
      ...(keeperBootstrap ? keeperBootstrap.league : {}),
      ...(isGuillotine
        ? {
            playoffStartWeek: null,
            playoffTeams: null,
            playoffWeeksPerRound: null,
            playoffSeedingRule: null,
            playoffLowerBracket: null,
            guillotineEndgame: 'final_two',
            guillotineEndgameThreshold: 2,
            guillotineEliminationsPerPeriod: 1,
            guillotineProtectedWeek1: false,
            guillotineTiebreaker: 'lowest_bench_points',
            guillotineSamePeriodPickups: false,
            guillotineWaiverDelay: guillotineDefaultWaiverDelayHours,
            guillotineFinalStageScoring: 'cumulative',
          }
        : {}),
      ...leagueModeColumns(formatId),
    },
  })

  await tx.scoringSettingsSnapshot.create({
    data: {
      leagueId: league.id,
      season: seasonYear,
      week: null,
      formatKey: formatId,
      scoringMode,
      scoringFormat,
      templateId: body.scoringPreset,
      modifiers: resolution.modifiers.map((modifier) => String(modifier)),
      effectiveRules: scoringSettings as Prisma.InputJsonValue,
      overrides: Prisma.JsonNull,
    },
  })

  if (isGuillotine) {
    await tx.guillotineLeagueConfig.upsert({
      where: { leagueId: league.id },
      create: {
        leagueId: league.id,
        eliminationStartWeek: 1,
        eliminationEndWeek: guillotineProfile?.regularSeasonWeeks ?? null,
        teamsPerChop: 1,
        correctionWindow: 'after_stat_corrections',
        statCorrectionHours: guillotineProfile?.correctionWindowHours ?? 48,
        tiebreakerOrder: ['bench_points', 'season_points', 'previous_period', 'draft_slot', 'commissioner', 'random'] as unknown as Prisma.InputJsonValue,
        dangerMarginPoints: 10,
        rosterReleaseTiming: 'next_waiver_run',
        commissionerOverride: true,
      },
      update: {
        eliminationEndWeek: guillotineProfile?.regularSeasonWeeks ?? null,
        statCorrectionHours: guillotineProfile?.correctionWindowHours ?? 48,
      },
    })
  }

  const isIdpLeague = resolution.modifiers.includes('idp') && supportsIdpLeagueSport(sport)
  if (isIdpLeague) {
    await tx.idpLeagueConfig.upsert({
      where: { leagueId: league.id },
      create: {
        leagueId: league.id,
        positionMode: 'standard',
        rosterPreset: 'standard',
        scoringPreset: body.scoringPreset.toLowerCase().includes('idp') ? 'balanced' : 'balanced',
        bestBallEnabled: formatId === 'best_ball',
        draftType: coreDraft,
        benchSlots: readNumber(foundationDefaults.rosterSettings, 'benchSlots', 7),
        irSlots: readNumber(foundationDefaults.rosterSettings, 'irSlots', 2),
      },
      update: {
        draftType: coreDraft,
        benchSlots: readNumber(foundationDefaults.rosterSettings, 'benchSlots', 7),
        irSlots: readNumber(foundationDefaults.rosterSettings, 'irSlots', 2),
      },
    })
  }

  if (formatId === 'devy') {
    const setup = (body.conceptSetup ?? {}) as Record<string, unknown>
    const devyConfig = foundationDefaults.devyConfig ?? {}
    const devySettings = foundationDefaults.devySettings ?? {}
    const rosterSettings = foundationDefaults.rosterSettings
    const collegeSportsRaw = devySettings.collegeSports ?? devyConfig.collegeSports
    const collegeSports = Array.isArray(collegeSportsRaw)
      ? collegeSportsRaw.map((entry) => String(entry)).filter(Boolean)
      : ['NCAAF']
    const devySlotCount = readNumber(
      setup,
      'devySlotCount',
      readNumber(devyConfig, 'devySlotCount', readNumber(rosterSettings, 'collegeRosterSlots', 6)),
    )
    const taxiSize = readNumber(
      setup,
      'taxiSize',
      readNumber(devyConfig, 'taxiSize', readNumber(rosterSettings, 'taxiSlots', 6)),
    )
    const devyIRSlots = readNumber(
      setup,
      'devyIRSlots',
      readNumber(devyConfig, 'devyIRSlots', readNumber(rosterSettings, 'devyIRSlots', 2)),
    )
    const rookieDraftRounds = readNumber(setup, 'rookieDraftRounds', readNumber(devyConfig, 'rookieDraftRounds', 4))
    const devyDraftRounds = readNumber(setup, 'devyDraftRounds', readNumber(devyConfig, 'devyDraftRounds', 4))
    const startupVetRounds = readNumber(devyConfig, 'startupVetRounds', draftRounds)
    const startupDraftType = readString(devyConfig, 'startupDraftType', coreDraft)
    const rookieDraftType = readString(devyConfig, 'rookieDraftType', 'linear')
    const devyDraftType = readString(devyConfig, 'devyDraftType', coreDraft === 'auction' ? 'auction' : 'linear')
    await tx.devyLeagueConfig.upsert({
      where: { leagueId: league.id },
      create: {
        leagueId: league.id,
        dynastyOnly: true,
        supportsStartupVetDraft: true,
        supportsRookieDraft: true,
        supportsDevyDraft: true,
        supportsBestBall: true,
        supportsSnakeDraft: true,
        supportsLinearDraft: true,
        supportsTaxi: true,
        supportsFuturePicks: true,
        supportsTradeableDevyPicks: true,
        supportsTradeableRookiePicks: true,
        devySlotCount,
        taxiSize,
        devyIRSlots,
        collegeSports: collegeSports as Prisma.InputJsonValue,
        rookieDraftRounds,
        devyDraftRounds,
        startupVetRounds,
        bestBallEnabled: false,
        startupDraftType,
        rookieDraftType,
        devyDraftType,
        rookiePickOrderMethod: readString(devyConfig, 'rookiePickOrderMethod', 'reverse_standings'),
        devyPickOrderMethod: readString(devyConfig, 'devyPickOrderMethod', 'reverse_standings'),
        devyPickTradeRules: readString(devyConfig, 'devyPickTradeRules', 'allowed'),
        rookiePickTradeRules: readString(devyConfig, 'rookiePickTradeRules', 'allowed'),
        nflDevyExcludeKDST: Boolean(devyConfig.nflDevyExcludeKDST ?? true),
        promotionTiming: readString(devyConfig, 'promotionTiming', 'manager_choice_before_rookie_draft'),
        returnToSchoolHandling: readString(devyConfig, 'returnToSchoolHandling', 'restore_rights'),
      },
      update: {
        devySlotCount,
        taxiSize,
        devyIRSlots,
        collegeSports: collegeSports as Prisma.InputJsonValue,
        rookieDraftRounds,
        devyDraftRounds,
        startupVetRounds,
        startupDraftType,
        rookieDraftType,
        devyDraftType,
        rookiePickOrderMethod: readString(devyConfig, 'rookiePickOrderMethod', 'reverse_standings'),
        devyPickOrderMethod: readString(devyConfig, 'devyPickOrderMethod', 'reverse_standings'),
        devyPickTradeRules: readString(devyConfig, 'devyPickTradeRules', 'allowed'),
        rookiePickTradeRules: readString(devyConfig, 'rookiePickTradeRules', 'allowed'),
        nflDevyExcludeKDST: Boolean(devyConfig.nflDevyExcludeKDST ?? true),
        promotionTiming: readString(devyConfig, 'promotionTiming', 'manager_choice_before_rookie_draft'),
        returnToSchoolHandling: readString(devyConfig, 'returnToSchoolHandling', 'restore_rights'),
      },
    })
  }

  if (formatId === 'c2c') {
    const setup = (body.conceptSetup ?? {}) as Record<string, unknown>
    await tx.c2CLeagueConfig.upsert({
      where: { leagueId: league.id },
      create: {
        leagueId: league.id,
        startupFormat: readString(setup, 'startupFormat', 'merged'),
        mergedStartupDraft: setup.startupFormat !== 'separate',
        separateStartupCollegeDraft: setup.startupFormat === 'separate',
        collegeRosterSize: readNumber(setup, 'collegeRosterSize', readNumber(foundationDefaults.rosterSettings, 'collegeRosterSlots', 20)),
        collegeSports: [sport] as Prisma.InputJsonValue,
        collegeScoringSystem: readString(setup, 'collegeScoringSystem', 'ppr'),
        mixProPlayers: setup.mixProPlayers !== false,
        taxiSize: readNumber(setup, 'taxiSize', readNumber(foundationDefaults.rosterSettings, 'taxiSlots', 6)),
        startupDraftType: coreDraft,
        rookieDraftType: 'linear',
        collegeDraftType: 'snake',
      },
      update: {
        startupDraftType: coreDraft,
      },
    })
  }

  const isDynastyFormat = formatId === 'dynasty' || formatId === 'devy' || formatId === 'c2c'
  if (isDynastyFormat) {
    const ds = (body.conceptSetup ?? {}) as Record<string, unknown>
    const num = (v: unknown, fallback: number) => (v !== undefined && v !== null ? Number(v) : fallback)
    const str = (v: unknown, fallback: string) => (v !== undefined && v !== null ? String(v) : fallback)
    const dynastyFallbackTaxiSlots =
      formatId === 'devy' ? readNumber(foundationDefaults.rosterSettings, 'taxiSlots', 6) : 4
    const dynastyFallbackRookieRounds =
      formatId === 'devy' ? readNumber(foundationDefaults.devyConfig, 'rookieDraftRounds', 4) : 4
    const dynastyFallbackRookieDraftType =
      formatId === 'devy' ? readString(foundationDefaults.devyConfig, 'rookieDraftType', 'linear') : 'linear'
    await tx.dynastyLeagueConfig.upsert({
      where: { leagueId: league.id },
      create: {
        leagueId: league.id,
        regularSeasonWeeks: num(ds.regularSeasonWeeks, 14),
        rookiePickOrderMethod: str(ds.rookieDraftOrderMethod, 'max_pf'),
        useMaxPfForNonPlayoff: true,
        rookieDraftRounds: num(ds.rookieDraftRounds, dynastyFallbackRookieRounds),
        rookieDraftType: str(ds.rookieDraftType, dynastyFallbackRookieDraftType),
        divisionsEnabled: num(ds.divisionCount, 0) > 0,
        futurePicksYearsOut: num(ds.futurePicksYearsOut, 3),
        waiverTypeRecommended: str(ds.waiverTypeRecommended, 'faab'),
        taxiSlots: num(ds.taxiSlots, dynastyFallbackTaxiSlots),
        taxiEligibilityYears: num(ds.taxiEligibilityYears, 1),
        taxiLockBehavior: 'once_promoted_no_return',
        taxiInSeasonMoves: true,
        taxiPostseasonMoves: false,
        taxiScoringOn: false,
        taxiDeadlineWeek: ds.taxiLockDeadlineWeek != null ? num(ds.taxiLockDeadlineWeek, 0) || null : null,
      },
      update: {
        regularSeasonWeeks: num(ds.regularSeasonWeeks, 14),
        rookiePickOrderMethod: str(ds.rookieDraftOrderMethod, 'max_pf'),
        rookieDraftRounds: num(ds.rookieDraftRounds, dynastyFallbackRookieRounds),
        rookieDraftType: str(ds.rookieDraftType, dynastyFallbackRookieDraftType),
        divisionsEnabled: num(ds.divisionCount, 0) > 0,
        futurePicksYearsOut: num(ds.futurePicksYearsOut, 3),
        waiverTypeRecommended: str(ds.waiverTypeRecommended, 'faab'),
        taxiSlots: num(ds.taxiSlots, dynastyFallbackTaxiSlots),
        taxiEligibilityYears: num(ds.taxiEligibilityYears, 1),
        taxiDeadlineWeek: ds.taxiLockDeadlineWeek != null ? num(ds.taxiLockDeadlineWeek, 0) || null : null,
      },
    })
  }

  await tx.leagueSettings.create({
    data: {
      leagueId: league.id,
      timezone: body.timezone ?? 'America/New_York',
      draftType: coreDraft,
      rounds: draftRounds,
      pickTimerPreset,
      pickTimerCustomValue: null,
      cpuAutoPick: true,
      aiAutoPick: isAuto,
      draftOrderMethod: bestBallSettings?.orderMethod === 'randomize' ? 'random' : 'manual',
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

  await tx.redraftLeagueExtendedSettings.create({
    data: {
      leagueId: league.id,
      commissionerTradeReviewType: tradeReview,
      languageCode: body.language ?? 'en',
      scoringTypeDefault: body.scoringPreset,
      waiverTypeDefault: waiverDefaults.waiver_type,
      rosterPresetKey: `default-${sport}-${formatId}`,
      playoffPresetKey: 'default',
      draftTimerSecondsDefault: timerSeconds,
      isPublic: bestBallSettings?.visibility === 'public',
      allowInviteLinks: true,
      allowMemberInviteRankBypass: false,
      settingsJson: {
        tradeReviewMode: tradeReview,
        canonicalFormatId: formatId,
        bestBallSettings: bestBallSettings ?? undefined,
      },
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
      auctionBudget: body.draftType.toLowerCase().includes('auction') ? 200 : null,
      draftStatus: isOffline ? 'offline' : 'pre_draft',
      configJson: {
        coreDraftSessionType: coreDraft,
        canonicalCreate: true,
        presetKey: engine.presetKey,
        ...(bestBallSettings ? { bestBallSettings } : {}),
        ...(foundationDefaults.keeperPolicy ? { keeperPolicy: foundationDefaults.keeperPolicy } : {}),
        ...(foundationDefaults.devyConfig ? { devyConfig: foundationDefaults.devyConfig } : {}),
        ...(foundationDefaults.playerPoolRules ? { playerPoolRules: foundationDefaults.playerPoolRules } : {}),
      } as Prisma.InputJsonValue,
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
      homepageConfigJson: { createdVia: 'canonical_v1' },
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
      integrationConfigJson: { source: 'canonical_v1', soccerPipeline: soccerPipeline ?? undefined },
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
      playerData: {
        draftPicks: [],
        foundation: {
          slotNumber: 1,
          openTeam: false,
          createdBy: 'canonical_create',
        },
      },
      settings: {
        openSlot: false,
        commissioner: true,
      },
    },
  })

  await tx.leagueTeam.create({
    data: {
      leagueId: league.id,
      externalId: roster.id,
      ownerName: managerName,
      teamName: `${managerName}'s Team`,
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

  const draftSlotOrder: Prisma.InputJsonValue[] = [
    {
      slot: 1,
      rosterId: roster.id,
      displayName: managerName,
      open: false,
    },
  ]
  const slotData: Prisma.LeagueEntrySlotCreateManyInput[] = []
  slotData.push({
    id: randomUUID(),
    leagueId: league.id,
    slotNumber: 1,
    status: 'FILLED',
    rosterId: roster.id,
  })

  for (let slot = 2; slot <= managerCount; slot++) {
    const openTeamName = buildOpenTeamName(slot)
    const openRoster = await tx.roster.create({
      data: {
        leagueId: league.id,
        platformUserId: `open-slot-${league.id}-${slot}`,
        playerData: {
          draftPicks: [],
          foundation: {
            slotNumber: slot,
            openTeam: true,
            label: openTeamName,
            createdBy: 'canonical_create',
          },
        },
        settings: {
          openSlot: true,
          aiManaged: false,
        },
      },
    })

    await tx.leagueTeam.create({
      data: {
        leagueId: league.id,
        externalId: openRoster.id,
        ownerName: openTeamName,
        teamName: openTeamName,
        claimedByUserId: null,
        platformUserId: openRoster.platformUserId,
        isOrphan: true,
        isCommissioner: false,
        role: 'member',
      },
    })

    slotData.push({
      id: randomUUID(),
      leagueId: league.id,
      slotNumber: slot,
      status: 'OPEN',
      rosterId: openRoster.id,
    })
    draftSlotOrder.push({
      slot,
      rosterId: openRoster.id,
      displayName: openTeamName,
      open: true,
    })
  }
  await tx.leagueEntrySlot.createMany({ data: slotData })

  const auctionBudget = body.draftType.toLowerCase().includes('auction') ? 200 : null
  // Dynasty devy-rounds opt-in (Option B slice): the trailing startup rounds become
  // devy-only, mirroring the devy format's default (getLeagueDefaults writes
  // devyRounds = [rounds - 1, rounds]). The live-draft engine keys off
  // DraftSession.devyConfig, not leagueType, so no DevyLeagueConfig row is created
  // and the build-excluded /devy surfaces stay untouched.
  const dynastyDevySetup = (body.conceptSetup ?? {}) as Record<string, unknown>
  const dynastyDevyRoundCount =
    formatId === 'dynasty' &&
    sport === 'NFL' &&
    coreDraft !== 'auction' &&
    draftRounds > 1 &&
    dynastyDevySetup.devyRoundsEnabled === true
      ? Math.max(1, Math.min(4, Math.floor(readNumber(dynastyDevySetup, 'devyRoundCount', 2)), draftRounds - 1))
      : 0
  const dynastyDevyConfig =
    dynastyDevyRoundCount > 0
      ? {
          enabled: true,
          devyRounds: Array.from(
            { length: dynastyDevyRoundCount },
            (_, i) => draftRounds - dynastyDevyRoundCount + 1 + i,
          ),
        }
      : null
  const sessionDevyConfig =
    (draftSettings.devyConfig as Record<string, unknown> | null | undefined) ?? dynastyDevyConfig
  await tx.draftSession.create({
    data: {
      leagueId: league.id,
      status: 'pre_draft',
      draftType: coreDraft,
      rounds: draftRounds,
      teamCount: managerCount,
      timerSeconds,
      slotOrder: draftSlotOrder as Prisma.InputJsonValue,
      auctionBudgetPerTeam: auctionBudget,
      sportType: sport,
      sessionKind: 'live',
      cpuAutoPick: true,
      aiAutoPick: isAuto,
      ...(sessionDevyConfig ? { devyConfig: sessionDevyConfig as Prisma.InputJsonValue } : {}),
      ...(draftSettings.c2cConfig ? { c2cConfig: draftSettings.c2cConfig as Prisma.InputJsonValue } : {}),
      ...(keeperBootstrap
        ? {
            keeperConfig: keeperBootstrap.draftKeeperConfig as unknown as Prisma.InputJsonValue,
            keeperSelections: [] as Prisma.InputJsonValue,
          }
        : {}),
    },
  })

  // ── Salary cap league config ──────────────────────────────────────────────
  if (formatId === 'salary_cap') {
    const cs = (body.conceptSetup ?? {}) as Record<string, unknown>
    const num = (v: unknown, fallback: number) =>
      v !== undefined && v !== null && !Number.isNaN(Number(v)) ? Number(v) : fallback
    const bool = (v: unknown, fallback: boolean) =>
      v !== undefined && v !== null ? Boolean(v) : fallback
    const str = (v: unknown, fallback: string) =>
      typeof v === 'string' && v.length > 0 ? v : fallback

    const isCollegeSport = sport === 'NCAAB' || sport === 'NCAAF'
    const startupDraftType = str(cs.draftMode, 'auction') === 'snake' ? 'snake' : 'auction'
    const defaultCap =
      sport === 'NBA' || sport === 'NHL'
        ? 200
        : sport === 'NCAAB'
          ? 150
          : 250

    await tx.salaryCapLeagueConfig.upsert({
      where: { leagueId: league.id },
      create: {
        leagueId: league.id,
        mode: 'dynasty',
        startupCap: num(cs.totalCap, defaultCap),
        capGrowthPercent: 5,
        contractMinYears: 1,
        contractMaxYears: num(cs.maxContractYears, isCollegeSport ? 3 : 4),
        rookieContractYears: num(cs.defaultContractYears, isCollegeSport ? 2 : 3),
        minimumSalary: num(cs.minSalary, 1),
        deadMoneyEnabled: bool(cs.deadMoneyEnabled, true),
        deadMoneyPercentPerYear: 25,
        rolloverEnabled: bool(cs.capRolloverEnabled, true),
        rolloverMax: num(cs.rolloverMax, isCollegeSport ? 0 : 25),
        capFloorEnabled: bool(cs.capFloorEnabled, false),
        capFloorAmount: null,
        extensionsEnabled: true,
        franchiseTagEnabled: bool(cs.franchiseTagEnabled, false),
        rookieOptionEnabled: false,
        startupDraftType,
        futureDraftType: 'snake',
        auctionHoldback: num(cs.auctionHoldback, 50),
        weightedLotteryEnabled: false,
        lotteryOddsConfig: undefined,
        compPickEnabled: false,
        compPickFormula: undefined,
        offseasonPhase: null,
        offseasonPhaseEndsAt: null,
      },
      update: { startupDraftType },
    })

    log?.('salary_cap_config_upserted', {
      leagueId: league.id,
      startupDraftType,
    })
  }

  const invite = await tx.leagueInvite.create({
    data: {
      leagueId: league.id,
      createdBy: appUserId,
      createdByRole: 'COMMISSIONER',
      maxUses: 50,
      isActive: true,
      bypassRankGate: false,
    },
  })
  const inviteUrl = `/join/${invite.token}`

  const conceptSetup = (body.conceptSetup ?? {}) as Record<string, unknown>
  const visibility =
    bestBallSettings?.visibility === 'public' ||
    conceptSetup.visibility === 'public' ||
    conceptSetup.isPublic === true
      ? 'public'
      : 'private'
  const isFinderListingActive = visibility === 'public'
  const finderListingHeadline = `${body.leagueName.trim()} | Rank ${minRankLevel}-${maxRankLevel}`
  const finderListingBody = JSON.stringify({
    leagueId: league.id,
    leagueName: body.leagueName.trim(),
    concept: formatId,
    sport,
    draftType: body.draftType,
    scoringPreset: body.scoringPreset,
    currentTeams: 1,
    maxTeams: managerCount,
    creatorRankLevel,
    minRankLevel,
    maxRankLevel,
    visibility,
    teamCount: managerCount,
    timezone: body.timezone ?? 'America/New_York',
    language: body.language ?? 'en',
    inviteUrl,
  })

  await tx.findLeagueListing.upsert({
    where: {
      leagueId_rosterId: {
        leagueId: league.id,
        rosterId: roster.id,
      },
    },
    create: {
      leagueId: league.id,
      rosterId: roster.id,
      sport,
      creatorRankLevel,
      minRankLevel,
      maxRankLevel,
      isActive: isFinderListingActive,
      headline: finderListingHeadline,
      body: finderListingBody,
    },
    update: {
      sport,
      creatorRankLevel,
      minRankLevel,
      maxRankLevel,
      isActive: isFinderListingActive,
      headline: finderListingHeadline,
      body: finderListingBody,
    },
  })

  const zombieTier =
    formatId === 'zombie' && body.conceptSetup && typeof body.conceptSetup === 'object'
      ? (body.conceptSetup.universe === 'MULTI_TIER' ? 'beta_trio' : 'single_gamma')
      : null

  const homepageUrl = buildPostCreateLeagueHomeHref({
    leagueId: league.id,
    leagueType: formatId,
    allowInviteLink: true,
    zombieUniverseTier: zombieTier,
  })

  log?.('canonical_transaction_success', { leagueId: league.id })

  return { leagueId: league.id, homepageUrl, inviteUrl }
}
