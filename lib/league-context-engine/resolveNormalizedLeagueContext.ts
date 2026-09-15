import 'server-only'

import { assertLeagueMemberWithCode } from '@/lib/league/league-access'
import { prisma } from '@/lib/prisma'
import { normalizeToSupportedSport } from '@/lib/sport-scope'

import { normalizeLeagueScoring } from '@/lib/league-context-engine/normalizeScoring'
import { resolveMatchupPeriod } from '@/lib/league-context-engine/resolvePeriod'
import { normalizeBestBallSettings } from '@/lib/bestball/rules'
import { resolveLeagueConcept } from '@/lib/league/leagueConceptOptions'
import type {
  LeagueSourceType,
  NormalizedLeagueContext,
  ResolveLeagueContextOptions,
  ResolveLeagueContextResult,
} from '@/lib/league-context-engine/types'

function mapSourceType(platform: string): LeagueSourceType {
  const p = platform.toLowerCase()
  if (p === 'allfantasy' || p === 'af') return 'native_af'
  if (p === 'sleeper') return 'imported_sleeper'
  if (p === 'yahoo') return 'imported_yahoo'
  if (p === 'espn') return 'imported_espn'
  if (p === 'fantrax') return 'imported_fantrax'
  if (p === 'mfl') return 'imported_mfl'
  if (p === 'fleaflicker') return 'imported_fleaflicker'
  if (p === 'fantasypros') return 'imported_fantasypros'
  if (p && p !== 'unknown') return 'imported_other'
  return 'unknown'
}

function settingsRecord(settings: unknown): Record<string, unknown> | null {
  if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
    return settings as Record<string, unknown>
  }
  return null
}

export function importMappingHealthy(args: {
  platform: string
  platformLeagueId: string | null
  syncError: string | null
}): boolean {
  const p = args.platform.toLowerCase()
  if (p === 'allfantasy' || p === 'af') return true
  if (!args.platformLeagueId?.trim()) return false
  if (args.syncError?.trim()) return false
  return true
}

/**
 * Single entry point: membership-validated league row → fully normalized AI league context.
 */
export async function resolveNormalizedLeagueContext(
  opts: ResolveLeagueContextOptions,
): Promise<ResolveLeagueContextResult> {
  const trimmed = opts.leagueId?.trim()
  if (!trimmed) return { ok: false, code: 'INVALID_LEAGUE_ID' }
  if (!opts.userId?.trim()) return { ok: false, code: 'MISSING_USER_CONTEXT' }

  const access = await assertLeagueMemberWithCode(trimmed, opts.userId)
  if (!access.ok) return { ok: false, code: access.code }

  const league = await prisma.league.findFirst({
    where: { id: trimmed },
    include: {
      teams: true,
      salaryCapConfig: {
        select: {
          startupCap: true,
          minimumSalary: true,
          mode: true,
        },
      },
    },
  })

  if (!league) return { ok: false, code: 'LEAGUE_NOT_FOUND' }

  if (
    !importMappingHealthy({
      platform: league.platform,
      platformLeagueId: league.platformLeagueId,
      syncError: league.syncError,
    })
  ) {
    return { ok: false, code: 'IMPORT_MAPPING_MISSING' }
  }

  let team = league.teams.find((t) => t.claimedByUserId === opts.userId) ?? null

  const prefTeamId = opts.preferredTeamId?.trim()
  if (prefTeamId) {
    const hit = league.teams.find((t) => t.id === prefTeamId)
    if (!hit) return { ok: false, code: 'TEAM_NOT_FOUND' }
    team = hit
  } else if (opts.preferredTeamExternalId?.trim()) {
    const ext = opts.preferredTeamExternalId.trim()
    const hit = league.teams.find((t) => t.externalId === ext)
    if (!hit) return { ok: false, code: 'TEAM_NOT_FOUND' }
    team = hit
  }

  const settings = settingsRecord(league.settings)
  const sport = normalizeToSupportedSport(String(league.sport))
  const scoring = normalizeLeagueScoring({
    sport: league.sport,
    scoringColumn: league.scoring,
    settings,
    starters: league.starters,
  })

  const matchupPeriod = await resolveMatchupPeriod({
    sport,
    leagueSeason: league.season,
  })

  const bestBallSettings = league.bestBallMode
    ? normalizeBestBallSettings({
        sport: league.sport,
        conceptSetup: (settings?.best_ball_settings as Record<string, unknown> | null) ?? null,
        draftType: typeof settings?.canonical_draft_mode === 'string' ? settings.canonical_draft_mode : 'snake',
        timezone: league.timezone,
        language: league.language as 'en' | 'es' | null,
      })
    : null

  const lineupBehavior = {
    scoringPeriod:
      league.bbScoringPeriod === 'daily' ? ('daily' as const) : ('weekly' as const),
    bestBallMode: league.bestBallMode === true,
    bestBallSettings: bestBallSettings
      ? {
          mode: bestBallSettings.mode,
          matchupFormat: bestBallSettings.matchupFormat,
          waiversEnabled: bestBallSettings.waiversEnabled,
          tradesEnabled: bestBallSettings.tradesEnabled,
          substitutionsEnabled: bestBallSettings.substitutionsEnabled,
          lineupTemplateId: bestBallSettings.lineupTemplateId,
        }
      : null,
  }

  const effectiveLeagueType = resolveLeagueConcept(league.settings, league.leagueType)
  const lt = effectiveLeagueType?.toLowerCase() ?? ''
  const lv = (league.leagueVariant ?? '').toLowerCase()
  const flags = {
    isDynasty: league.isDynasty === true,
    isKeeper: lt.includes('keeper') || lv.includes('keeper'),
    isDevy: lv.includes('devy') || lt.includes('devy'),
    isC2C: lv.includes('c2c') || lt.includes('c2c'),
    bestBallMode: league.bestBallMode === true,
    guillotineMode: league.guillotineMode === true,
    survivorMode: league.survivorMode === true,
  }

  const salaryCap = {
    enabled: Boolean(league.salaryCapConfig),
    startupCap: league.salaryCapConfig?.startupCap ?? null,
    minimumSalary: league.salaryCapConfig?.minimumSalary ?? null,
    mode: league.salaryCapConfig?.mode ?? null,
  }

  const mappingOk = importMappingHealthy({
    platform: league.platform,
    platformLeagueId: league.platformLeagueId,
    syncError: league.syncError,
  })

  const ctx: NormalizedLeagueContext = {
    schemaVersion: 1,
    leagueId: league.id,
    userId: opts.userId,
    team: team
      ? {
          teamId: team.id,
          externalId: team.externalId,
          teamName: team.teamName,
          platformUserId: team.platformUserId,
          isLeagueCommissioner: league.isCommissioner === true,
          isTeamCommissioner: team.isCommissioner === true,
          isCoCommissioner: team.isCoCommissioner === true,
        }
      : null,
    sport: String(league.sport),
    leagueName: league.name,
    leagueType: effectiveLeagueType,
    leagueVariant: league.leagueVariant,
    sourceType: mapSourceType(league.platform),
    platform: league.platform,
    platformLeagueId: league.platformLeagueId,
    season: league.season,
    leagueStatus: league.status,
    matchupPeriod,
    scoring,
    roster: {
      rosterSize: league.rosterSize,
      starters: league.starters,
      irSlots: league.irSlots,
      taxiSlots: league.taxiSlots,
      taxiAllowNonRookies: league.taxiAllowNonRookies,
      taxiYearsLimit: league.taxiYearsLimit,
    },
    lineupBehavior,
    waiver: {
      waiverType: league.waiverType,
      waiverBudget: league.waiverBudget,
      waiverMinBid: league.waiverMinBid,
      waiverClearAfterGames: league.waiverClearAfterGames,
      waiverHours: league.waiverHours,
      customDailyWaivers: league.customDailyWaivers,
      waiverProcessTime: league.waiverProcessTime,
      waiverSchedule: league.waiverSchedule,
    },
    trade: {
      tradeReviewHours: league.tradeReviewHours,
      tradeDeadlineWeek: league.tradeDeadlineWeek,
      draftPickTrading: league.draftPickTrading,
    },
    playoff: {
      playoffStartWeek: league.playoffStartWeek,
      playoffTeams: league.playoffTeams,
      playoffWeeksPerRound: league.playoffWeeksPerRound,
      playoffSeedingRule: league.playoffSeedingRule,
      playoffLowerBracket: league.playoffLowerBracket,
    },
    flags,
    salaryCap,
    commissioner: {
      userIsHeadCommissionerOnImport: league.isCommissioner === true,
      userTeamCommissionerFlags: {
        isCommissioner: team?.isCommissioner === true,
        isCoCommissioner: team?.isCoCommissioner === true,
      },
    },
    importHealth: {
      importedAt: league.importedAt?.toISOString() ?? null,
      lastSyncedAt: league.lastSyncedAt?.toISOString() ?? null,
      syncStatus: league.syncStatus,
      syncError: league.syncError,
      mappingOk,
    },
    timezone: league.timezone,
  }

  return { ok: true, context: ctx }
}
