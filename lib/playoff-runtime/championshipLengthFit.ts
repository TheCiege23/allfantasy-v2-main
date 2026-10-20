/**
 * Would a championship length push the final past the end of the league's season?
 *
 * 🛑 A FINAL THAT ENDS AFTER THE SEASON NEVER SEALS. `totalWeeks` is fixed when the season is created
 * and nothing resizes it, so lengthening the final on, say, an NFL league whose playoffs start in week
 * 16 asks for a week 19 the sport does not have: the finalizer never seals it, the scorer never writes
 * the final, and the season never completes — with nothing red anywhere. Commissioner writes of
 * `championship_length` are checked here first.
 *
 * The last week is computed by `lastWeekOfPlayoffRound`, the rule the scorer and
 * `resolveLastPlayoffWeek` use. Against the latest season's `totalWeeks` when one exists (its stored
 * playoff start, and its bracket's final round once generated); otherwise against the season league
 * creation would produce (`resolveCreatedSeasonWeeks`, the sport default, the same start-week rule as
 * `ensureRedraftSeason`).
 *
 * ⚠ ONLY A CHANGE THAT MOVES THE LAST WEEK LATER IS REFUSED. Shortening is always allowed, and a
 * league whose bracket already overruns its stored length — an imported season stores a REGULAR-season
 * length in `totalWeeks` (leagueSeasonWeek.ts), and no-playoff formats set the playoff start past the
 * end on purpose — is not blocked from a change that does not make it worse.
 */

import type { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '@/lib/prisma'
import { leagueSportToConfigSport } from '@/lib/redraft/sportKey'
import { tryGetSportConfig } from '@/lib/sportConfig'
import { resolveCreatedSeasonWeeks } from '@/lib/redraft/createdSeasonLength'
import { CHAMPIONSHIP_ROUND_WHERE, lastWeekOfPlayoffRound, readChampionshipLength } from './playoffRoundWeeks'

export type ChampionshipLengthOverflow = {
  lastPlayoffWeek: number
  seasonWeeks: number
  /** Where `seasonWeeks` came from. */
  basis: 'season' | 'creation'
}

type LeagueForFit = {
  id: string
  sport?: unknown
  settings?: unknown
  playoffTeams?: number | null
  playoffWeeksPerRound?: number | null
  playoffStartWeek?: number | null
  dynastyConfig?: { regularSeasonWeeks: number } | null
  bestBallMode?: boolean | null
  bbContestId?: string | null
}

function withChampionshipLength(settings: unknown, championshipLength: number): Record<string, unknown> {
  const s = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {}
  const structure =
    s.playoff_structure && typeof s.playoff_structure === 'object' && !Array.isArray(s.playoff_structure)
      ? (s.playoff_structure as Record<string, unknown>)
      : {}
  return { ...s, playoff_structure: { ...structure, championship_length: championshipLength } }
}

/** Null when the new length fits (or does not move the final later); the overrun otherwise. */
export async function championshipLengthOverflow(
  input: { league: LeagueForFit; championshipLength: number },
  deps: { prisma?: PrismaClient } = {},
): Promise<ChampionshipLengthOverflow | null> {
  const db = deps.prisma ?? (defaultPrisma as unknown as PrismaClient)
  const { league, championshipLength } = input

  const season = await db.redraftSeason.findFirst({
    where: { leagueId: league.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, totalWeeks: true, playoffStartWeek: true },
  })

  let rounds: number
  let playoffStartWeek: number
  let seasonWeeks: number
  let basis: ChampionshipLengthOverflow['basis']
  const teams = Number(league.playoffTeams ?? 0)
  const roundsFromTeams = teams >= 2 ? Math.ceil(Math.log2(teams)) : 0

  if (season) {
    const finalRound = await db.redraftPlayoffRound.findFirst({
      where: { seasonId: season.id, roundNumber: CHAMPIONSHIP_ROUND_WHERE },
      orderBy: { roundNumber: 'desc' },
      select: { roundNumber: true },
    })
    rounds = finalRound?.roundNumber ?? roundsFromTeams
    playoffStartWeek = season.playoffStartWeek
    seasonWeeks = season.totalWeeks
    basis = 'season'
  } else {
    // The season `ensureRedraftSeason` would create — sized with the NEW length, as creation would.
    const cfg = tryGetSportConfig(leagueSportToConfigSport(String(league.sport ?? 'NFL')))
    const dynastyConfig =
      league.dynastyConfig !== undefined
        ? league.dynastyConfig
        : ((await db.league.findUnique({
            where: { id: league.id },
            select: { dynastyConfig: { select: { regularSeasonWeeks: true } } },
          })) as { dynastyConfig?: { regularSeasonWeeks: number } | null } | null)?.dynastyConfig ?? null
    seasonWeeks = resolveCreatedSeasonWeeks(
      { ...league, dynastyConfig, settings: withChampionshipLength(league.settings, championshipLength) },
      cfg?.defaultSeasonWeeks ?? 17,
    )
    const leagueStart = Number(league.playoffStartWeek)
    playoffStartWeek =
      Number.isInteger(leagueStart) && leagueStart >= 2 && leagueStart <= seasonWeeks
        ? leagueStart
        : cfg?.defaultPlayoffStartWeek ?? 15
    rounds = roundsFromTeams
    basis = 'creation'
  }
  if (rounds < 1) return null

  const lastWeek = (length: number | null) =>
    lastWeekOfPlayoffRound({
      playoffStartWeek,
      roundNumber: rounds,
      weeksPerRound: league.playoffWeeksPerRound,
      finalRoundNumber: rounds,
      championshipLength: length,
    })
  const next = lastWeek(championshipLength)
  const current = lastWeek(readChampionshipLength(league.settings))
  if (next <= seasonWeeks || next <= current) return null
  return { lastPlayoffWeek: next, seasonWeeks, basis }
}

export function championshipLengthOverflowMessage(o: ChampionshipLengthOverflow): string {
  return `A final that long would end in week ${o.lastPlayoffWeek}, past the season's last week (${o.seasonWeeks}). Shorten the final or move the playoffs earlier.`
}
