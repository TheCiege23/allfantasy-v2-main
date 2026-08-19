/**
 * Ensures a league has LeagueWaiverSettings with sport- and variant-aware defaults.
 * Idempotent: creates when missing and fills only missing/null fields when present.
 *
 * Block D (Sleeper import fidelity Tier 0 follow-up) — when the League row carries
 * imported `settings.waiverSettings` from a provider import (populated by the Tier 0
 * canonical normalizer via `SleeperLeagueMapper`), the imported values are preferred
 * over sport defaults. This closes the residual "waiver contradiction" where
 * `leagues.waiverType`/`waiverBudget` reflected Sleeper truth (post PR #179) but the
 * sibling `league_waiver_settings.faabBudget` was still overwritten to the NFL
 * sport-default (100) instead of the real 250.
 */
import { prisma } from '@/lib/prisma'
import { getWaiverDefaults } from '@/lib/sport-defaults/SportDefaultsRegistry'
import type { SportType } from '@/lib/sport-defaults/types'
import { toSportType } from '@/lib/sport-defaults/sport-type-utils'

export interface LeagueWaiverBootstrapResult {
  leagueId: string
  waiverSettingsApplied: boolean
  sport: string
  variant: string | null
}

/**
 * Block D helper — extract imported waiver values (Tier 0 canonical slice) from the
 * League row's `settings` JSONB. Reads the canonical `settings.waiverSettings` slice
 * (populated by `canonicalImportNormalizer` for any Sleeper import) and returns
 * `undefined` for absent / wrong-typed values so callers can cleanly fall back to
 * sport defaults.
 *
 * IMPORTANT: this only READS from settings; it never widens the mapper's contract.
 * Processing day / time are deliberately NOT surfaced here — Sleeper stores those
 * in Pacific-local time (`daily_waivers_hour`) which cannot be safely converted to
 * UTC without knowing PST/PDT for the run date. Sport defaults remain the source
 * of truth for those two fields until a mapper-level fix explicitly extracts them.
 */
function readImportedWaiverSettings(rawSettings: unknown): {
  waiverType?: string
  faabBudget?: number
} {
  if (rawSettings == null || typeof rawSettings !== 'object' || Array.isArray(rawSettings)) {
    return {}
  }
  const settings = rawSettings as Record<string, unknown>
  const slice = settings.waiverSettings
  if (slice == null || typeof slice !== 'object' || Array.isArray(slice)) {
    return {}
  }
  const s = slice as Record<string, unknown>
  const waiverType =
    typeof s.waiverType === 'string' && s.waiverType.length > 0 ? s.waiverType : undefined
  const faabBudget =
    typeof s.faabBudget === 'number' && Number.isFinite(s.faabBudget) ? s.faabBudget : undefined
  return { waiverType, faabBudget }
}

/**
 * Ensure league has LeagueWaiverSettings. If missing, create with sport/variant defaults
 * (overridden by imported Sleeper values when available). When settings already exist,
 * only missing/null keys are backfilled — matching Block D scope requirement 3
 * ("Existing non-import league behavior does not change") by leaving user-set values alone.
 */
export async function bootstrapLeagueWaiverSettings(leagueId: string): Promise<LeagueWaiverBootstrapResult> {
  const league = await (prisma as any).league.findUnique({
    where: { id: leagueId },
    select: { id: true, sport: true, leagueVariant: true, settings: true },
  })
  if (!league) {
    return { leagueId, waiverSettingsApplied: false, sport: '', variant: null }
  }

  const existing = await (prisma as any).leagueWaiverSettings.findUnique({
    where: { leagueId },
  })

  const sport = (league.sport as string) || 'NFL'
  const variant = league.leagueVariant ?? null
  const sportType = toSportType(sport) as SportType
  const waiverDef = getWaiverDefaults(sportType, variant ?? undefined)

  // Block D — prefer imported Sleeper values over sport defaults for the two
  // fields we can safely round-trip: `waiverType` (canonical enum string) and
  // `faabBudget` (number). Absent / wrong-typed imported values fall back to
  // sport defaults so non-import (UI-created) leagues behave unchanged.
  const imported = readImportedWaiverSettings(league.settings)

  const defaultFields = {
    waiverType: imported.waiverType ?? waiverDef.waiver_type,
    faabBudget: imported.faabBudget ?? waiverDef.FAAB_budget_default,
    processingDayOfWeek: waiverDef.processing_days?.[0] ?? null,
    processingTimeUtc: waiverDef.processing_time_utc ?? null,
    claimLimitPerPeriod: waiverDef.max_claims_per_period ?? null,
    tiebreakRule: (waiverDef.claim_priority_behavior as string) ?? null,
    lockType: (waiverDef.game_lock_behavior as string) ?? null,
    instantFaAfterClear: waiverDef.free_agent_unlock_behavior === 'instant',
  }

  if (existing) {
    const patch: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(defaultFields)) {
      const current = (existing as Record<string, unknown>)[key]
      if (current === undefined || current === null) patch[key] = value
    }
    if (Object.keys(patch).length === 0) {
      return {
        leagueId,
        waiverSettingsApplied: false,
        sport,
        variant,
      }
    }

    await (prisma as any).leagueWaiverSettings.update({
      where: { leagueId },
      data: patch,
    })

    return { leagueId, waiverSettingsApplied: true, sport, variant }
  }

  await (prisma as any).leagueWaiverSettings.create({
    data: {
      leagueId,
      ...defaultFields,
    },
  })

  return { leagueId, waiverSettingsApplied: true, sport, variant }
}
