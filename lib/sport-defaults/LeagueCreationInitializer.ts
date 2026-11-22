/**
 * Applies sport-specific default league settings when a league is created.
 * Writes to League.settings (JSON) and optionally LeagueWaiverSettings.
 *
 * Commissioner overrides: when mergeIfExisting is true, existing League.settings are merged
 * with initial sport defaults (existing keys take precedence), so commissioner overrides
 * are preserved. When mergeIfExisting is false, settings are only applied when the league
 * has no settings yet (e.g. newly created); otherwise no write occurs.
 */
import { prisma } from '@/lib/prisma'
import { buildInitialLeagueSettings } from './LeagueDefaultSettingsService'
import { getWaiverDefaults } from './SportDefaultsRegistry'
import type { SportType } from './types'
import { toSportType } from './sport-type-utils'
import { defaultProcessingDaysList } from '@/lib/waiver-wire/free-agent-unlock'

export interface InitializeLeagueOptions {
  leagueId: string
  sport: SportType | string
  /** If false, only set settings when current settings are empty or null */
  mergeIfExisting?: boolean
}

/**
 * Initialize a league with sport-specific default settings.
 * - Merges initial settings into League.settings (so commissioner overrides can coexist).
 * - Creates or updates LeagueWaiverSettings from waiver defaults (waiver_type, FAAB_budget, processing_days).
 */
export async function initializeLeagueWithSportDefaults(
  options: InitializeLeagueOptions
): Promise<{ settingsApplied: boolean; waiverApplied: boolean }> {
  const { leagueId, sport, mergeIfExisting = true } = options
  const sportType = toSportType(typeof sport === 'string' ? sport : sport)

  const league = await (prisma as any).league.findUnique({
    where: { id: leagueId },
    select: { id: true, settings: true, leagueVariant: true },
  })
  if (!league) {
    return { settingsApplied: false, waiverApplied: false }
  }

  const initialSettings = buildInitialLeagueSettings(sportType, league.leagueVariant ?? undefined)
  let settingsApplied = false
  const existingSettings = (league.settings as Record<string, unknown>) ?? {}
  const hasExisting = Object.keys(existingSettings).length > 0
  if (!hasExisting) {
    await (prisma as any).league.update({
      where: { id: leagueId },
      data: { settings: { ...initialSettings } },
    })
    settingsApplied = true
  } else if (mergeIfExisting) {
    const merged = { ...initialSettings, ...existingSettings }
    await (prisma as any).league.update({
      where: { id: leagueId },
      data: { settings: merged },
    })
    settingsApplied = true
  }

  const waiverDef = getWaiverDefaults(sportType, league.leagueVariant ?? undefined)
  // Daily sports (NBA [1,3,5], MLB [1,4], NHL [1,3,5]) run on every listed day; persisting only
  // processing_days[0] scheduled them once a week. Single-day sports (NFL) write no list — unchanged.
  const defaultDaysList = defaultProcessingDaysList(waiverDef.processing_days)
  let waiverApplied = false
  try {
    const existing = await (prisma as any).leagueWaiverSettings.findUnique({
      where: { leagueId },
    })
    if (!existing) {
      await (prisma as any).leagueWaiverSettings.create({
        data: {
          leagueId,
          waiverType: waiverDef.waiver_type,
          faabBudget: waiverDef.FAAB_budget_default,
          processingDayOfWeek: waiverDef.processing_days?.[0] ?? null,
          processingTimeUtc: waiverDef.processing_time_utc ?? null,
          claimLimitPerPeriod: waiverDef.max_claims_per_period ?? null,
          tiebreakRule: (waiverDef.claim_priority_behavior as string) ?? null,
          lockType: (waiverDef.game_lock_behavior as string) ?? null,
          instantFaAfterClear: waiverDef.free_agent_unlock_behavior === 'instant',
          ...(defaultDaysList ? { processingDays: defaultDaysList } : {}),
        },
      })
      waiverApplied = true
    } else {
      const patch: Record<string, unknown> = {}
      const defaults = {
        waiverType: waiverDef.waiver_type,
        faabBudget: waiverDef.FAAB_budget_default,
        processingDayOfWeek: waiverDef.processing_days?.[0] ?? null,
        processingTimeUtc: waiverDef.processing_time_utc ?? null,
        claimLimitPerPeriod: waiverDef.max_claims_per_period ?? null,
        tiebreakRule: (waiverDef.claim_priority_behavior as string) ?? null,
        lockType: (waiverDef.game_lock_behavior as string) ?? null,
        instantFaAfterClear: waiverDef.free_agent_unlock_behavior === 'instant',
      }
      for (const [key, value] of Object.entries(defaults)) {
        const current = (existing as Record<string, unknown>)[key]
        if (current === undefined || current === null) patch[key] = value
      }
      // Only alongside a day that is itself being filled from defaults: a commissioner-chosen
      // processingDayOfWeek is never overridden by the sport's default day list.
      const existingRow = existing as Record<string, unknown>
      if (
        defaultDaysList &&
        'processingDayOfWeek' in patch &&
        (existingRow.processingDays === undefined || existingRow.processingDays === null)
      ) {
        patch.processingDays = defaultDaysList
      }
      if (Object.keys(patch).length > 0) {
        await (prisma as any).leagueWaiverSettings.update({
          where: { leagueId },
          data: patch,
        })
        waiverApplied = true
      }
    }
  } catch (error) {
    console.warn('[league-defaults/initializer] Failed to initialize waiver defaults:', error)
  }

  return { settingsApplied, waiverApplied }
}
