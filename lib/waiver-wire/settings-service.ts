import { prisma } from "@/lib/prisma"
import { DEFAULT_SPORT } from "@/lib/sport-scope"
import { getWaiverDefaults } from "@/lib/sport-defaults/SportDefaultsRegistry"
import { toSportType } from "@/lib/sport-defaults/sport-type-utils"
import type { LeagueWaiverSettingsInput } from "./types"
import {
  normalizeWaiverTypeForEngine,
  parseWaiverEngineConfig,
  type WaiverEngineConfigJson,
} from "./waiver-engine-config"
import { defaultProcessingDaysList, resolveFreeAgentUnlockBehavior } from "./free-agent-unlock"
import {
  readFaabRolloverRule,
  readFreeAgencyMode,
  readOffseasonWaiverRule,
  readPlayoffWaiverRule,
  type FaabRolloverRule,
  type FreeAgencyMode,
  type OffseasonWaiverRule,
  type PlayoffWaiverRule,
} from "./hub-waiver-options"

function toIntOrNull(value: unknown): number | null {
  if (value == null || value === "") return null
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

function readLeagueSettingsWaiverOverrides(settings: unknown): {
  waiverType?: string
  processingDayOfWeek?: number | null
  processingDaysList?: number[] | null
  processingTimeUtc?: string | null
  claimLimitPerPeriod?: number | null
  faabBudget?: number | null
  tiebreakRule?: string | null
  lockType?: string | null
  instantFaAfterClear?: boolean
} {
  const src = (settings ?? {}) as Record<string, unknown>
  const processingDaysRaw = src.waiver_processing_days
  const processingDays = Array.isArray(processingDaysRaw)
    ? processingDaysRaw.map((v) => toIntOrNull(v)).filter((v): v is number => v != null)
    : []
  const unlockBehavior = typeof src.waiver_free_agent_unlock_behavior === "string"
    ? src.waiver_free_agent_unlock_behavior.trim().toLowerCase()
    : null
  return {
    waiverType:
      typeof src.waiver_type === "string" && src.waiver_type.trim()
        ? src.waiver_type.trim()
        : typeof src.waiver_mode === "string" && src.waiver_mode.trim()
          ? src.waiver_mode.trim()
          : undefined,
    processingDayOfWeek: processingDays.length > 0 ? processingDays[0] : undefined,
    processingDaysList: processingDays.length > 0 ? defaultProcessingDaysList(processingDays) : undefined,
    processingTimeUtc:
      typeof src.waiver_processing_time_utc === "string" && src.waiver_processing_time_utc.trim()
        ? src.waiver_processing_time_utc.trim()
        : undefined,
    claimLimitPerPeriod: src.waiver_max_claims_per_period === undefined
      ? undefined
      : toIntOrNull(src.waiver_max_claims_per_period),
    faabBudget: src.faab_budget === undefined ? undefined : toIntOrNull(src.faab_budget),
    tiebreakRule:
      typeof src.waiver_claim_priority_behavior === "string" && src.waiver_claim_priority_behavior.trim()
        ? src.waiver_claim_priority_behavior.trim()
        : undefined,
    lockType:
      typeof src.waiver_game_lock_behavior === "string" && src.waiver_game_lock_behavior.trim()
        ? src.waiver_game_lock_behavior.trim()
        : undefined,
    instantFaAfterClear:
      unlockBehavior === "instant"
        ? true
        : unlockBehavior != null
          ? false
          : undefined,
  }
}

export async function getLeagueWaiverSettings(leagueId: string) {
  const row = await (prisma as any).leagueWaiverSettings.findUnique({
    where: { leagueId },
  })
  return row
}

/** Effective waiver settings for UI/API: DB row or sport/variant defaults. Never null. */
export async function getEffectiveLeagueWaiverSettings(leagueId: string): Promise<{
  leagueId: string
  waiverType: string
  processingDayOfWeek: number | null
  processingTimeUtc: string | null
  claimLimitPerPeriod: number | null
  claimLimitPerWeek: number | null
  claimLimitPerRun: number | null
  faabBudget: number | null
  faabResetDate: Date | null
  faabResetType: string | null
  waiverOrderResetPolicy: string | null
  postGameWaiverBehavior: string | null
  processingDays: unknown | null
  freeAgentWindowRules: unknown | null
  tiebreakRule: string | null
  lockType: string | null
  instantFaAfterClear: boolean
  /**
   * Sport/variant `free_agent_unlock_behavior`, or the league's explicit
   * `settings.waiver_free_agent_unlock_behavior`. `'daily'` (NBA/MLB/NHL) = players not on waivers
   * are first-come free agents (see lib/waiver-wire/free-agent-unlock.ts).
   */
  freeAgentUnlockBehavior: string | null
  specialtyConceptOverrides: unknown | null
  waiverEngineConfig: WaiverEngineConfigJson
  normalizedWaiverType: string
  faabMinBid: number | null
  allowZeroFaabBid: boolean
  maxDropsPerWeek: number | null
  commissionerOverrideRules: unknown | null
  /** `waiverEngineConfig.offseason_waiver_rules` (season-phase-policy.ts); default `closed`. */
  offseasonWaiverRule: OffseasonWaiverRule
  /** `waiverEngineConfig.playoff_waiver_rules`; default `all_teams`. */
  playoffWaiverRule: PlayoffWaiverRule
  /** `waiverEngineConfig.free_agency_mode` (after-run-free-agency.ts); default `standard`. */
  freeAgencyMode: FreeAgencyMode
  /** `waiverEngineConfig.faab_rollover_rule` (faab-rollover.ts); null = never chosen. */
  faabRolloverRule: FaabRolloverRule | null
}> {
  const [league, row] = await Promise.all([
    (prisma as any).league.findUnique({
      where: { id: leagueId },
      select: { id: true, sport: true, leagueVariant: true, settings: true },
    }),
    (prisma as any).leagueWaiverSettings.findUnique({ where: { leagueId } }),
  ])
  const sportForDefaults = (league?.sport as string) || DEFAULT_SPORT
  const variantForDefaults = league?.leagueVariant ?? null
  const sportDefaults = getWaiverDefaults(toSportType(sportForDefaults) as any, variantForDefaults ?? undefined)
  const freeAgentUnlockBehavior = resolveFreeAgentUnlockBehavior(
    league?.settings,
    sportDefaults.free_agent_unlock_behavior,
  )
  if (row) {
    const engineConfig = parseWaiverEngineConfig(row.waiverEngineConfig ?? null)
    const wt = row.waiverType ?? "standard"
    const mergedPeriod =
      row.claimLimitPerPeriod ??
      (typeof engineConfig.max_claims_per_period === "number" ? engineConfig.max_claims_per_period : null)
    const mergedWeek =
      row.claimLimitPerWeek ??
      (typeof engineConfig.max_adds_per_week === "number" ? engineConfig.max_adds_per_week : null)
    return {
      leagueId,
      waiverType: wt,
      processingDayOfWeek: row.processingDayOfWeek ?? null,
      processingTimeUtc: row.processingTimeUtc ?? null,
      claimLimitPerPeriod: mergedPeriod,
      claimLimitPerWeek: mergedWeek,
      claimLimitPerRun: row.claimLimitPerRun ?? null,
      faabBudget: row.faabBudget ?? null,
      faabResetDate: row.faabResetDate ?? null,
      faabResetType: row.faabResetType ?? null,
      waiverOrderResetPolicy: row.waiverOrderResetPolicy ?? null,
      postGameWaiverBehavior: row.postGameWaiverBehavior ?? null,
      processingDays: row.processingDays ?? null,
      freeAgentWindowRules: row.freeAgentWindowRules ?? null,
      tiebreakRule: row.tiebreakRule ?? engineConfig.faab_tiebreaker ?? null,
      lockType: row.lockType ?? null,
      instantFaAfterClear: row.instantFaAfterClear ?? true,
      freeAgentUnlockBehavior,
      specialtyConceptOverrides: row.specialtyConceptOverrides ?? null,
      waiverEngineConfig: engineConfig,
      normalizedWaiverType: normalizeWaiverTypeForEngine(wt),
      faabMinBid: typeof engineConfig.faab_min_bid === "number" ? engineConfig.faab_min_bid : null,
      allowZeroFaabBid: engineConfig.allow_zero_faab_bid !== false,
      maxDropsPerWeek:
        typeof engineConfig.max_drops_per_week === "number" ? engineConfig.max_drops_per_week : null,
      commissionerOverrideRules: row.commissionerOverrideRules ?? null,
      offseasonWaiverRule: readOffseasonWaiverRule(engineConfig.offseason_waiver_rules),
      playoffWaiverRule: readPlayoffWaiverRule(engineConfig.playoff_waiver_rules),
      freeAgencyMode: readFreeAgencyMode(engineConfig.free_agency_mode),
      faabRolloverRule: readFaabRolloverRule(engineConfig.faab_rollover_rule),
    }
  }
  const defaults = sportDefaults
  const overrides = readLeagueSettingsWaiverOverrides(league?.settings)
  const resolvedWaiverType = overrides.waiverType ?? defaults.waiver_type ?? "standard"
  const resolvedTiebreakRule =
    overrides.tiebreakRule ?? (defaults.claim_priority_behavior as string) ?? null
  const resolvedLockType = overrides.lockType ?? (defaults.game_lock_behavior as string) ?? null
  const resolvedInstantFa =
    overrides.instantFaAfterClear ??
    (defaults.free_agent_unlock_behavior === "instant")
  return {
    leagueId,
    waiverType: resolvedWaiverType,
    processingDayOfWeek:
      overrides.processingDayOfWeek ??
      (Array.isArray(defaults.processing_days) && defaults.processing_days.length > 0 ? defaults.processing_days[0] : null),
    processingTimeUtc: overrides.processingTimeUtc ?? defaults.processing_time_utc ?? null,
    claimLimitPerPeriod: overrides.claimLimitPerPeriod ?? defaults.max_claims_per_period ?? null,
    claimLimitPerWeek: null,
    claimLimitPerRun: null,
    faabBudget: overrides.faabBudget ?? defaults.FAAB_budget_default ?? null,
    faabResetDate: null,
    faabResetType: null,
    waiverOrderResetPolicy: null,
    postGameWaiverBehavior: null,
    // An explicit settings day list wins; otherwise the sport's multi-day default (NBA [1,3,5]) —
    // but never a default list under a commissioner's single explicit day. NFL stays null.
    processingDays:
      overrides.processingDaysList !== undefined
        ? overrides.processingDaysList
        : overrides.processingDayOfWeek !== undefined
          ? null
          : defaultProcessingDaysList(defaults.processing_days),
    freeAgentWindowRules: null,
    tiebreakRule: resolvedTiebreakRule,
    lockType: resolvedLockType,
    instantFaAfterClear: resolvedInstantFa,
    freeAgentUnlockBehavior,
    specialtyConceptOverrides: null,
    waiverEngineConfig: {},
    normalizedWaiverType: normalizeWaiverTypeForEngine(resolvedWaiverType),
    faabMinBid: null,
    allowZeroFaabBid: true,
    maxDropsPerWeek: null,
    commissionerOverrideRules: null,
    offseasonWaiverRule: "closed",
    playoffWaiverRule: "all_teams",
    freeAgencyMode: "standard",
    faabRolloverRule: null,
  }
}

export async function upsertLeagueWaiverSettings(
  leagueId: string,
  input: LeagueWaiverSettingsInput
) {
  const [league, existing] = await Promise.all([
    (prisma as any).league.findUnique({
      where: { id: leagueId },
      select: { sport: true, leagueVariant: true },
    }),
    (prisma as any).leagueWaiverSettings.findUnique({
      where: { leagueId },
    }),
  ])
  const sport = (league?.sport as string) || DEFAULT_SPORT
  const variant = league?.leagueVariant ?? null
  const defaults = getWaiverDefaults(toSportType(sport) as any, variant ?? undefined)
  const fallbackWaiverType = existing?.waiverType ?? defaults.waiver_type ?? "standard"
  const fallbackProcessingDay =
    existing?.processingDayOfWeek ??
    (Array.isArray(defaults.processing_days) && defaults.processing_days.length > 0 ? defaults.processing_days[0] : null)
  const fallbackProcessingTime = existing?.processingTimeUtc ?? defaults.processing_time_utc ?? null
  const fallbackClaimLimit = existing?.claimLimitPerPeriod ?? defaults.max_claims_per_period ?? null
  const fallbackFaabBudget = existing?.faabBudget ?? defaults.FAAB_budget_default ?? null
  const fallbackTiebreak = existing?.tiebreakRule ?? (defaults.claim_priority_behavior as string) ?? null
  const fallbackLockType = existing?.lockType ?? (defaults.game_lock_behavior as string) ?? null
  const fallbackInstantFa =
    existing?.instantFaAfterClear ??
    (defaults.free_agent_unlock_behavior === "instant")

  const data = {
    waiverType: input.waiverType ?? fallbackWaiverType,
    processingDayOfWeek:
      input.processingDayOfWeek === undefined ? fallbackProcessingDay : input.processingDayOfWeek,
    processingTimeUtc:
      input.processingTimeUtc === undefined ? fallbackProcessingTime : input.processingTimeUtc,
    claimLimitPerPeriod:
      input.claimLimitPerPeriod === undefined ? fallbackClaimLimit : input.claimLimitPerPeriod,
    claimLimitPerWeek:
      input.claimLimitPerWeek === undefined ? (existing?.claimLimitPerWeek ?? null) : input.claimLimitPerWeek,
    claimLimitPerRun:
      input.claimLimitPerRun === undefined ? (existing?.claimLimitPerRun ?? null) : input.claimLimitPerRun,
    faabBudget:
      input.faabBudget === undefined ? fallbackFaabBudget : input.faabBudget,
    faabResetDate:
      input.faabResetDate === undefined
        ? (existing?.faabResetDate ?? null)
        : input.faabResetDate
          ? new Date(input.faabResetDate)
          : null,
    faabResetType: input.faabResetType === undefined ? (existing?.faabResetType ?? null) : input.faabResetType,
    waiverOrderResetPolicy:
      input.waiverOrderResetPolicy === undefined
        ? (existing?.waiverOrderResetPolicy ?? null)
        : input.waiverOrderResetPolicy,
    postGameWaiverBehavior:
      input.postGameWaiverBehavior === undefined
        ? (existing?.postGameWaiverBehavior ?? null)
        : input.postGameWaiverBehavior,
    processingDays: input.processingDays === undefined ? (existing?.processingDays ?? null) : input.processingDays,
    freeAgentWindowRules:
      input.freeAgentWindowRules === undefined ? (existing?.freeAgentWindowRules ?? null) : input.freeAgentWindowRules,
    dropRestrictions: input.dropRestrictions === undefined ? (existing?.dropRestrictions ?? null) : input.dropRestrictions,
    commissionerOverrideRules:
      input.commissionerOverrideRules === undefined
        ? (existing?.commissionerOverrideRules ?? null)
        : input.commissionerOverrideRules,
    specialtyConceptOverrides:
      input.specialtyConceptOverrides === undefined
        ? (existing?.specialtyConceptOverrides ?? null)
        : input.specialtyConceptOverrides,
    waiverEngineConfig:
      input.waiverEngineConfig === undefined ? (existing?.waiverEngineConfig ?? null) : input.waiverEngineConfig,
    tiebreakRule:
      input.tiebreakRule === undefined ? fallbackTiebreak : input.tiebreakRule,
    lockType:
      input.lockType === undefined ? fallbackLockType : input.lockType,
    instantFaAfterClear:
      input.instantFaAfterClear === undefined ? fallbackInstantFa : input.instantFaAfterClear,
  }
  const row = await (prisma as any).leagueWaiverSettings.upsert({
    where: { leagueId },
    create: { leagueId, ...data },
    update: data,
  })
  // Best-effort: the settings row is saved; a failed seed must not fail the save.
  await seedNullFaabBalances(leagueId).catch((err) => {
    console.warn("[waiver-settings] FAAB balance seed failed", { leagueId, error: err instanceof Error ? err.message : String(err) })
  })
  return row
}

/**
 * 🛑 TURNING FAAB ON NEVER GAVE ANY TEAM MONEY. `Roster.faabRemaining` has no default and no native
 * create, join or settings path set it, while the waiver engine reads NULL as 0 — so every bid in a
 * native league that enabled FAAB was refused as "Insufficient FAAB" (found 2026-10-18 on a live
 * NBA guillotine league). This gives each team with NO balance the league's effective budget.
 *
 * Only NULL balances are written: a team that already has a number has either been seeded or spent,
 * and resetting it would refund spending. Returns how many teams were seeded.
 */
export async function seedNullFaabBalances(leagueId: string): Promise<{ seeded: number; budget: number | null }> {
  const effective = await getEffectiveLeagueWaiverSettings(leagueId)
  const budget = effective.faabBudget
  if (effective.normalizedWaiverType !== "faab" || budget == null || budget <= 0) {
    return { seeded: 0, budget: budget ?? null }
  }
  const res = await (prisma as any).roster.updateMany({
    where: { leagueId, faabRemaining: null },
    data: { faabRemaining: budget },
  })
  return { seeded: res?.count ?? 0, budget }
}
