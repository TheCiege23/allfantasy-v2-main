/**
 * Load and validate Guillotine league config from DB.
 * Sport-aware defaults per PROMPT 331 / sport-scope.
 */

import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { SUPPORTED_SPORTS, normalizeToSupportedSport } from '@/lib/sport-scope'
import type { LeagueSport } from '@prisma/client'
import {
  DEFAULT_STAT_CORRECTION_HOURS,
  DEFAULT_DANGER_MARGIN_POINTS,
  DEFAULT_TIEBREAKER_ORDER,
  CORRECTION_AFTER_STAT,
  RELEASE_NEXT_WAIVER,
} from './constants'
import type { GuillotineConfig, TiebreakStep } from './types'

const GUILLOTINE_VARIANT = 'guillotine'

/** Default elimination end week by sport (must match guillotine sport regular-season lengths). */
const DEFAULT_END_WEEK_BY_SPORT: Partial<Record<LeagueSport, number>> = {
  NFL: 18,
  NHL: 24,
  NBA: 24,
  MLB: 26,
  NCAAF: 14,
  NCAAB: 20,
  SOCCER: 38,
}

function parseTiebreakerOrder(raw: unknown): TiebreakStep[] {
  if (Array.isArray(raw) && raw.length > 0) {
    const allowed = new Set<TiebreakStep>([
      'bench_points',
      'season_points',
      'previous_period',
      'draft_slot',
      'commissioner',
      'random',
    ])
    const out = raw.filter((s): s is TiebreakStep => typeof s === 'string' && allowed.has(s as TiebreakStep))
    if (out.length) return out
  }
  return [...DEFAULT_TIEBREAKER_ORDER]
}

/**
 * Returns true if the league is configured as a guillotine league.
 */
export async function isGuillotineLeague(leagueId: string): Promise<boolean> {
  const config = await prisma.guillotineLeagueConfig.findUnique({
    where: { leagueId },
    select: { id: true },
  })
  if (config) return true
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { leagueVariant: true },
  })
  return league?.leagueVariant === GUILLOTINE_VARIANT
}

/**
 * Load full guillotine config for a league. Creates default config from League.settings if none exists and league is guillotine.
 */
export async function getGuillotineConfig(leagueId: string): Promise<GuillotineConfig | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      id: true,
      sport: true,
      leagueVariant: true,
      settings: true,
    },
  })
  if (!league) return null
  const sport = normalizeToSupportedSport(league.sport) as LeagueSport

  const row = await prisma.guillotineLeagueConfig.findUnique({
    where: { leagueId },
  })
  if (row) {
    return {
      leagueId: row.leagueId,
      sport,
      eliminationStartWeek: row.eliminationStartWeek,
      eliminationEndWeek: row.eliminationEndWeek,
      teamsPerChop: row.teamsPerChop,
      correctionWindow: row.correctionWindow as GuillotineConfig['correctionWindow'],
      customCutoffDayOfWeek: row.customCutoffDayOfWeek,
      customCutoffTimeUtc: row.customCutoffTimeUtc,
      statCorrectionHours: row.statCorrectionHours ?? DEFAULT_STAT_CORRECTION_HOURS,
      tiebreakerOrder: parseTiebreakerOrder(row.tiebreakerOrder),
      dangerMarginPoints: row.dangerMarginPoints ?? DEFAULT_DANGER_MARGIN_POINTS,
      rosterReleaseTiming: row.rosterReleaseTiming as GuillotineConfig['rosterReleaseTiming'],
      commissionerOverride: row.commissionerOverride,
    }
  }

  if (league.leagueVariant !== GUILLOTINE_VARIANT) return null

  const settings = (league.settings ?? {}) as Record<string, unknown>
  const defaultEndWeek =
    DEFAULT_END_WEEK_BY_SPORT[sport] ?? 18
  return {
    leagueId: league.id,
    sport,
    eliminationStartWeek: (settings.eliminationStartWeek as number) ?? 1,
    eliminationEndWeek: (settings.eliminationEndWeek as number) ?? defaultEndWeek,
    teamsPerChop: (settings.teamsPerChop as number) ?? 1,
    correctionWindow: (settings.correctionWindow as GuillotineConfig['correctionWindow']) ?? CORRECTION_AFTER_STAT,
    customCutoffDayOfWeek: (settings.customCutoffDayOfWeek as number) ?? null,
    customCutoffTimeUtc: (settings.customCutoffTimeUtc as string) ?? null,
    statCorrectionHours: (settings.statCorrectionHours as number) ?? DEFAULT_STAT_CORRECTION_HOURS,
    tiebreakerOrder: parseTiebreakerOrder(settings.tiebreakerOrder ?? DEFAULT_TIEBREAKER_ORDER),
    dangerMarginPoints: (settings.dangerMarginPoints as number) ?? DEFAULT_DANGER_MARGIN_POINTS,
    rosterReleaseTiming: (settings.rosterReleaseTiming as GuillotineConfig['rosterReleaseTiming']) ?? RELEASE_NEXT_WAIVER,
    commissionerOverride: (settings.commissionerOverride as boolean) ?? true,
  }
}

/**
 * Ensure a GuillotineLeagueConfig row exists for a guillotine league (e.g. after league creation).
 */
export async function upsertGuillotineConfig(
  leagueId: string,
  input: Partial<{
    eliminationStartWeek: number
    eliminationEndWeek: number | null
    teamsPerChop: number
    correctionWindow: string
    customCutoffDayOfWeek: number | null
    customCutoffTimeUtc: string | null
    statCorrectionHours: number | null
    tiebreakerOrder: TiebreakStep[]
    dangerMarginPoints: number | null
    rosterReleaseTiming: string
    commissionerOverride: boolean
  }>
): Promise<GuillotineConfig | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { sport: true },
  })
  if (!league) return null
  const sport = normalizeToSupportedSport(league.sport) as LeagueSport
  const defaultEnd = DEFAULT_END_WEEK_BY_SPORT[sport] ?? 18

  await prisma.guillotineLeagueConfig.upsert({
    where: { leagueId },
    create: {
      leagueId,
      eliminationStartWeek: input.eliminationStartWeek ?? 1,
      eliminationEndWeek: input.eliminationEndWeek ?? defaultEnd,
      teamsPerChop: input.teamsPerChop ?? 1,
      correctionWindow: input.correctionWindow ?? CORRECTION_AFTER_STAT,
      customCutoffDayOfWeek: input.customCutoffDayOfWeek ?? null,
      customCutoffTimeUtc: input.customCutoffTimeUtc ?? null,
      statCorrectionHours: input.statCorrectionHours ?? DEFAULT_STAT_CORRECTION_HOURS,
      tiebreakerOrder: toPrismaJsonInput(input.tiebreakerOrder ?? DEFAULT_TIEBREAKER_ORDER),
      dangerMarginPoints: input.dangerMarginPoints ?? DEFAULT_DANGER_MARGIN_POINTS,
      rosterReleaseTiming: input.rosterReleaseTiming ?? RELEASE_NEXT_WAIVER,
      commissionerOverride: input.commissionerOverride ?? true,
    },
    update: {
      ...(input.eliminationStartWeek !== undefined && { eliminationStartWeek: input.eliminationStartWeek }),
      ...(input.eliminationEndWeek !== undefined && { eliminationEndWeek: input.eliminationEndWeek }),
      ...(input.teamsPerChop !== undefined && { teamsPerChop: input.teamsPerChop }),
      ...(input.correctionWindow !== undefined && { correctionWindow: input.correctionWindow }),
      ...(input.customCutoffDayOfWeek !== undefined && { customCutoffDayOfWeek: input.customCutoffDayOfWeek }),
      ...(input.customCutoffTimeUtc !== undefined && { customCutoffTimeUtc: input.customCutoffTimeUtc }),
      ...(input.statCorrectionHours !== undefined && { statCorrectionHours: input.statCorrectionHours }),
      ...(input.tiebreakerOrder !== undefined && { tiebreakerOrder: toPrismaJsonInput(input.tiebreakerOrder) }),
      ...(input.dangerMarginPoints !== undefined && { dangerMarginPoints: input.dangerMarginPoints }),
      ...(input.rosterReleaseTiming !== undefined && { rosterReleaseTiming: input.rosterReleaseTiming }),
      ...(input.commissionerOverride !== undefined && { commissionerOverride: input.commissionerOverride }),
    },
  })
  return getGuillotineConfig(leagueId)
}

export { SUPPORTED_SPORTS, DEFAULT_END_WEEK_BY_SPORT }
