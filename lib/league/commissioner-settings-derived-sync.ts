/**
 * Keeps derived stores in sync when commissioners edit canonical `League` columns from the settings UI:
 * - `League.settings.playoff_structure` / `playoffSettings` ← playoff columns (bracket resolver reads JSON)
 * - native leagues: `League.settings.playoffStartWeek` and the stage editor's `playoff_config_data`
 *   start week ← `playoffStartWeek` (the quick field is the source of truth; see resolvePlayoffStartWeek)
 * - `LeagueWaiverSettings` ← waiver columns (waiver engine prefers this row when present)
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { upsertLeagueWaiverSettings } from '@/lib/waiver-wire/settings-service'
import { parseWaiverEngineConfig } from '@/lib/waiver-wire/waiver-engine-config'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { firstRoundByesForTeams, playoffRoundsForTeams } from '@/lib/playoff-runtime/playoffFit'

/** The playoff stage editor's config key (lib/playoff-settings/PlayoffConfigService). */
const PLAYOFF_STAGE_CONFIG_KEY = 'playoff_config_data'

const PLAYOFF_COLUMNS = [
  'playoffStartWeek',
  'playoffTeams',
  'playoffWeeksPerRound',
  'playoffSeedingRule',
  'playoffLowerBracket',
] as const
const WAIVER_COLUMNS = [
  'waiverType',
  'waiverBudget',
  'waiverMinBid',
  'waiverHours',
  'customDailyWaivers',
  'waiverProcessTime',
  'waiverSchedule',
] as const

/**
 * After `League` row changes, mirror playoff + waiver fields into JSON + waiver settings row.
 *
 * ⚠ PASS `changedKeys`. `settings.playoff_structure` and the `LeagueWaiverSettings` row are also
 * written directly (the playoff fields that have no column, and PUT /api/commissioner/leagues/[id]/waivers),
 * which never update the `League` columns. Mirroring every column on every save therefore reverted those saves from
 * stale column values — a playoff-only save reset the waiver type and FAAB budget, a waiver-only
 * save reset the playoff team count. With `changedKeys`, only the columns this save changed are
 * mirrored onto values that already exist; a missing value is still filled from its column.
 * Omitted, every column is mirrored (the original behaviour).
 */
export async function syncCommissionerDerivedLeagueState(
  leagueId: string,
  changedKeys?: Iterable<string>,
): Promise<void> {
  const changed = changedKeys ? new Set(changedKeys) : null
  const touched = (key: string) => changed == null || changed.has(key)

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      settings: true,
      platform: true,
      playoffStartWeek: true,
      playoffTeams: true,
      playoffWeeksPerRound: true,
      playoffSeedingRule: true,
      playoffLowerBracket: true,
      waiverType: true,
      waiverBudget: true,
      waiverMinBid: true,
      waiverClearAfterGames: true,
      waiverHours: true,
      customDailyWaivers: true,
      waiverProcessTime: true,
      waiverSchedule: true,
    },
  })
  if (!league) return

  if (PLAYOFF_COLUMNS.some(touched)) {
    const prev = (league.settings as Record<string, unknown> | null) ?? {}

    const existingStructure =
      prev.playoff_structure != null && typeof prev.playoff_structure === 'object' && !Array.isArray(prev.playoff_structure)
        ? ({ ...(prev.playoff_structure as Record<string, unknown>) } as Record<string, unknown>)
        : ({} as Record<string, unknown>)
    /** Write `key` from `column` when this save changed the column, or the key has no value yet. */
    const mirror = (target: Record<string, unknown>, column: string, key: string) =>
      touched(column) || target[key] === undefined

    if (league.playoffTeams != null && mirror(existingStructure, 'playoffTeams', 'playoff_team_count')) {
      existingStructure.playoff_team_count = league.playoffTeams
    }
    // A new field size changes the bracket's byes and rounds; leaving the old ones beside it is how a
    // 4-team league came to show 2 byes and 3 rounds (PlayoffBracketConfigResolver now derives them too).
    const fieldChanged = touched('playoffTeams') && league.playoffTeams != null && league.playoffTeams >= 2
    if (fieldChanged) {
      existingStructure.first_round_byes = firstRoundByesForTeams(league.playoffTeams)
      existingStructure.total_rounds = playoffRoundsForTeams(league.playoffTeams)
    }
    if (league.playoffStartWeek != null && mirror(existingStructure, 'playoffStartWeek', 'playoff_start_week')) {
      existingStructure.playoff_start_week = league.playoffStartWeek
    }
    if (league.playoffWeeksPerRound != null) {
      if (mirror(existingStructure, 'playoffWeeksPerRound', 'matchup_length')) {
        existingStructure.matchup_length = league.playoffWeeksPerRound
      }
      if (mirror(existingStructure, 'playoffWeeksPerRound', 'playoff_weeks_per_round')) {
        existingStructure.playoff_weeks_per_round = league.playoffWeeksPerRound
      }
    }
    if (league.playoffSeedingRule != null && mirror(existingStructure, 'playoffSeedingRule', 'seeding_rules')) {
      existingStructure.seeding_rules = league.playoffSeedingRule
    }
    const lb = String(league.playoffLowerBracket ?? '').toLowerCase()
    if (lb && mirror(existingStructure, 'playoffLowerBracket', 'lower_bracket_type')) {
      existingStructure.toilet_bowl_enabled = lb === 'toilet'
      existingStructure.consolation_bracket_enabled = lb === 'consolation' || lb === 'consolation_bracket'
      existingStructure.lower_bracket_type = league.playoffLowerBracket
    }

    const playoffSettings: Record<string, unknown> =
      prev.playoffSettings != null && typeof prev.playoffSettings === 'object' && !Array.isArray(prev.playoffSettings)
        ? { ...(prev.playoffSettings as Record<string, unknown>) }
        : {}
    for (const column of PLAYOFF_COLUMNS) {
      if (mirror(playoffSettings, column, column)) playoffSettings[column] = league[column]
    }
    if (fieldChanged) {
      // The snake-case copies creation writes into the same block, and the flat key readers fall back to.
      Object.assign(playoffSettings, {
        playoff_team_count: league.playoffTeams,
        firstRoundByes: existingStructure.first_round_byes,
        first_round_byes: existingStructure.first_round_byes,
        totalRounds: existingStructure.total_rounds,
        total_rounds: existingStructure.total_rounds,
      })
    }
    if (touched('playoffStartWeek') && league.playoffStartWeek != null && 'playoff_start_week' in playoffSettings) {
      playoffSettings.playoff_start_week = league.playoffStartWeek
    }
    const flatTeamCount = fieldChanged && prev.playoff_team_count !== undefined ? { playoff_team_count: league.playoffTeams } : {}

    // Native leagues: the stage/bracket editor's copies follow the chosen week. Its stage config
    // keeps its playoff length, so the whole bracket shifts with the start week.
    const startWeekCopies: Record<string, unknown> = {}
    if (touched('playoffStartWeek') && league.playoffStartWeek != null && isNativePlatform(league.platform)) {
      startWeekCopies.playoffStartWeek = league.playoffStartWeek
      const stageConfig = prev[PLAYOFF_STAGE_CONFIG_KEY]
      if (stageConfig != null && typeof stageConfig === 'object' && !Array.isArray(stageConfig)) {
        startWeekCopies[PLAYOFF_STAGE_CONFIG_KEY] = {
          ...(stageConfig as Record<string, unknown>),
          adjustedPlayoffStartWeek: league.playoffStartWeek,
          adjustedRegularSeasonEndWeek: league.playoffStartWeek - 1,
        }
      }
    }

    await prisma.league.update({
      where: { id: leagueId },
      data: {
        settings: {
          ...prev,
          ...startWeekCopies,
          ...flatTeamCount,
          playoff_structure: existingStructure,
          playoffSettings,
        } as Prisma.InputJsonValue,
      },
    })
  }

  if (!WAIVER_COLUMNS.some(touched)) return

  const existingRow = await prisma.leagueWaiverSettings.findUnique({ where: { leagueId } })
  /** A new row takes every column; an existing row only the columns this save changed. */
  const take = (column: string) => !existingRow || touched(column)
  const engine = parseWaiverEngineConfig(existingRow?.waiverEngineConfig ?? null)
  const nextEngine: Record<string, unknown> = { ...engine }
  let engineTouched = false
  if (typeof league.waiverMinBid === 'number' && take('waiverMinBid')) {
    nextEngine.faab_min_bid = league.waiverMinBid
    engineTouched = true
  }
  if (typeof league.waiverHours === 'number' && take('waiverHours')) {
    nextEngine.minimum_waiver_time_hours = league.waiverHours
    engineTouched = true
  }
  if (league.customDailyWaivers != null && take('customDailyWaivers')) {
    nextEngine.custom_daily_waivers = league.customDailyWaivers
    engineTouched = true
  }

  await upsertLeagueWaiverSettings(leagueId, {
    waiverType: take('waiverType') ? league.waiverType ?? undefined : undefined,
    faabBudget: take('waiverBudget') ? league.waiverBudget ?? undefined : undefined,
    processingTimeUtc: take('waiverProcessTime') ? league.waiverProcessTime ?? undefined : undefined,
    processingDays: take('waiverSchedule') ? league.waiverSchedule ?? undefined : undefined,
    waiverEngineConfig: engineTouched ? nextEngine : undefined,
  })
}
