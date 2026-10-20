import { prisma } from '@/lib/prisma'
import { getRosterTemplateForLeague } from '@/lib/multi-sport/MultiSportRosterService'
import { getFormatTypeForVariant } from '@/lib/sport-defaults/LeagueVariantRegistry'
import type { LineupValidationContext } from '@/lib/roster-lineup-engine/types'
import { loadLeagueWeekContext, type LineupLockResolveArgs } from '@/lib/roster-lineup-engine/lineupLockService'
import { evaluateFullRosterLegalityAsync } from './evaluateFullRosterLegality'
import type { RosterLegalityFullResult } from './types'

export type PersistedRosterRef = {
  id: string
  leagueId: string
  playerData: unknown
}

/**
 * Builds the same evaluation inputs as GET `/api/leagues/[leagueId]/roster/legality`.
 */
export async function evaluateLegalityForPersistedRoster(
  roster: PersistedRosterRef,
): Promise<{ result: RosterLegalityFullResult; week: number; season: number } | null> {
  const league = await prisma.league.findFirst({ where: { id: roster.leagueId } })
  if (!league) return null

  const sport = String(league.sport ?? 'NFL')
  const formatType = getFormatTypeForVariant(sport, (league.leagueVariant as string | null) ?? undefined)

  let template
  try {
    template = await getRosterTemplateForLeague(sport as never, formatType, roster.leagueId)
  } catch {
    return null
  }

  const { season, week: leagueWeek } = await loadLeagueWeekContext(roster.leagueId, league.settings, league.season)
  const editingWeek = leagueWeek

  const ctx: LineupValidationContext = {
    league: {
      id: league.id,
      sport: league.sport,
      leagueVariant: league.leagueVariant,
      settings: league.settings,
      lifecycleState: league.lifecycleState,
      lockAllMoves: league.lockAllMoves,
      irAllowOut: league.irAllowOut,
      irAllowCovid: league.irAllowCovid,
      irAllowSuspended: league.irAllowSuspended,
      irAllowNA: league.irAllowNA,
      irAllowDNR: league.irAllowDNR,
      irAllowDoubtful: league.irAllowDoubtful,
      taxiSlots: league.taxiSlots,
      taxiAllowNonRookies: league.taxiAllowNonRookies,
      taxiYearsLimit: league.taxiYearsLimit,
      guillotineMode: league.guillotineMode,
      bestBallMode: league.bestBallMode,
    },
    template,
    season,
    week: editingWeek,
  }

  const lockArgs: LineupLockResolveArgs = {
    leagueId: roster.leagueId,
    rosterId: roster.id,
    sport,
    leagueVariant: league.leagueVariant,
    settings: league.settings,
    leagueWeek,
    editingWeek,
    season,
    playerData: roster.playerData,
    lockAllMoves: league.lockAllMoves,
    lifecycleState: league.lifecycleState,
  }

  const result = await evaluateFullRosterLegalityAsync({
    playerData: roster.playerData,
    ctx,
    lockArgs,
  })

  return { result, week: editingWeek, season }
}

/**
 * Same as {@link evaluateLegalityForPersistedRoster} but with hypothetical `playerData` (e.g. after add/drop).
 */
export async function evaluateLegalityForProjectedRoster(
  roster: PersistedRosterRef,
  projectedPlayerData: unknown,
): Promise<{ result: RosterLegalityFullResult; week: number; season: number } | null> {
  const league = await prisma.league.findFirst({ where: { id: roster.leagueId } })
  if (!league) return null

  const sport = String(league.sport ?? 'NFL')
  const formatType = getFormatTypeForVariant(sport, (league.leagueVariant as string | null) ?? undefined)

  let template
  try {
    template = await getRosterTemplateForLeague(sport as never, formatType, roster.leagueId)
  } catch {
    return null
  }

  const { season, week: leagueWeek } = await loadLeagueWeekContext(roster.leagueId, league.settings, league.season)
  const editingWeek = leagueWeek

  const ctx: LineupValidationContext = {
    league: {
      id: league.id,
      sport: league.sport,
      leagueVariant: league.leagueVariant,
      settings: league.settings,
      lifecycleState: league.lifecycleState,
      lockAllMoves: league.lockAllMoves,
      irAllowOut: league.irAllowOut,
      irAllowCovid: league.irAllowCovid,
      irAllowSuspended: league.irAllowSuspended,
      irAllowNA: league.irAllowNA,
      irAllowDNR: league.irAllowDNR,
      irAllowDoubtful: league.irAllowDoubtful,
      taxiSlots: league.taxiSlots,
      taxiAllowNonRookies: league.taxiAllowNonRookies,
      taxiYearsLimit: league.taxiYearsLimit,
      guillotineMode: league.guillotineMode,
      bestBallMode: league.bestBallMode,
    },
    template,
    season,
    week: editingWeek,
  }

  const lockArgs: LineupLockResolveArgs = {
    leagueId: roster.leagueId,
    rosterId: roster.id,
    sport,
    leagueVariant: league.leagueVariant,
    settings: league.settings,
    leagueWeek,
    editingWeek,
    season,
    playerData: projectedPlayerData,
    lockAllMoves: league.lockAllMoves,
    lifecycleState: league.lifecycleState,
  }

  const result = await evaluateFullRosterLegalityAsync({
    playerData: projectedPlayerData,
    ctx,
    lockArgs,
  })

  return { result, week: editingWeek, season }
}
