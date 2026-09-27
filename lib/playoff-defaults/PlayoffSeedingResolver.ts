/**
 * Resolves playoff seeding rules for a league. Used by standings, bracket generation, and matchup logic.
 */
import { resolveConfiguredPlayoffSeedingRule } from './seedingRule'
import { prisma } from '@/lib/prisma'
import { DEFAULT_SPORT } from '@/lib/sport-scope'
import { resolveDefaultPlayoffConfig } from '@/lib/sport-defaults/DefaultPlayoffConfigResolver'
import type { SportType } from '@/lib/sport-defaults/types'
import { toSportType } from '@/lib/sport-defaults/sport-type-utils'

export interface PlayoffSeedingConfig {
  seeding_rules: string
  tiebreaker_rules: string[]
  bye_rules: string | null
  reseed_behavior: string
  sport: string
  variant: string | null
}

/**
 * Get seeding rules for a league (for bracket and standings). Uses League.settings when present; else sport defaults.
 */
export async function getSeedingRulesForLeague(leagueId: string): Promise<PlayoffSeedingConfig | null> {
  const league = await (prisma as any).league.findUnique({
    where: { id: leagueId },
    select: { sport: true, leagueVariant: true, settings: true, playoffSeedingRule: true },
  })
  if (!league) return null

  const settings = (league.settings as Record<string, unknown>) ?? {}
  const sport = (league.sport as string) || DEFAULT_SPORT
  const variant = league.leagueVariant ?? null
  const sportType = toSportType(sport) as SportType
  const defaults = resolveDefaultPlayoffConfig(sportType, variant ?? undefined)

  const structure = settings.playoff_structure != null && typeof settings.playoff_structure === 'object'
    ? (settings.playoff_structure as Record<string, unknown>)
    : {}
  const fromSettings = <T>(key: string, fallback: T): T => {
    const valueInStructure = structure[key]
    if (valueInStructure !== undefined && valueInStructure !== null) return valueInStructure as T
    const valueInTopLevel = settings[key]
    if (valueInTopLevel !== undefined && valueInTopLevel !== null) return valueInTopLevel as T
    return fallback
  }

  const tiebreaker_rules = Array.isArray(structure.tiebreaker_rules)
    ? (structure.tiebreaker_rules as string[])
    : Array.isArray(settings.tiebreaker_rules)
      ? (settings.tiebreaker_rules as string[])
    : (defaults.tiebreaker_rules ?? [])

  return {
    seeding_rules: resolveConfiguredPlayoffSeedingRule(league, defaults.seeding_rules ?? 'standard_standings'),
    tiebreaker_rules,
    bye_rules: fromSettings<string | null>('bye_rules', defaults.bye_rules ?? null),
    reseed_behavior: fromSettings<string>('reseed_behavior', defaults.reseed_behavior ?? 'fixed_bracket'),
    sport,
    variant,
  }
}
