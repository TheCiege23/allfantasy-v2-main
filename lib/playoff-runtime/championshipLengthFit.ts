/**
 * Would a playoff settings change push the final past the end of the league's season?
 *
 * Every setting that moves the final is checked here: the playoff team count (rounds =
 * ceil(log2(teams)) — 9 to 16 teams is four rounds, which overruns every sport's default window), the
 * start week, weeks per round and the championship length (lib/playoff-runtime/playoffFit.ts). Only the
 * championship length used to be checked, so a commissioner could raise the field to twelve on an NFL
 * league starting in week 15 and get a week-18 final the 17-week season never plays.
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
import { maxPlayoffStartWeekFor } from '@/lib/redraft/regularSeasonCap'
import { CHAMPIONSHIP_ROUND_WHERE, lastWeekOfPlayoffRound, readChampionshipLength } from './playoffRoundWeeks'
import { maxPlayoffTeamsThatFit, playoffRoundsForTeams } from './playoffFit'

export type PlayoffFitOverflow = {
  lastPlayoffWeek: number
  seasonWeeks: number
  /** Where `seasonWeeks` came from. */
  basis: 'season' | 'creation'
  playoffStartWeek: number
  /** The largest field that fits with the requested start week, weeks per round and final; 0 when none. */
  maxPlayoffTeams: number
  /** False once a bracket is generated: its rounds are fixed, so the team count no longer moves the final. */
  teamsDecideRounds: boolean
}
/** @deprecated Kept for its callers; the check now covers every playoff setting. */
export type ChampionshipLengthOverflow = PlayoffFitOverflow

type LeagueForFit = {
  id: string
  sport?: unknown
  settings?: unknown
  leagueSize?: number | null
  playoffTeams?: number | null
  playoffWeeksPerRound?: number | null
  playoffStartWeek?: number | null
  dynastyConfig?: { regularSeasonWeeks: number } | null
  /** A redraft or keeper league's season follows the 24-week regular-season cap (regularSeasonCap.ts). */
  leagueType?: string | null
  bestBallMode?: boolean | null
  bbContestId?: string | null
}

/** The values a save would write; a key left undefined keeps the league's current value. */
export type PlayoffFitChange = {
  playoffTeams?: number | null
  playoffStartWeek?: number | null
  playoffWeeksPerRound?: number | null
  championshipLength?: number | null
}

function withChampionshipLength(settings: unknown, championshipLength: number | null): Record<string, unknown> {
  const s = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {}
  if (championshipLength == null) return s
  const structure =
    s.playoff_structure && typeof s.playoff_structure === 'object' && !Array.isArray(s.playoff_structure)
      ? (s.playoff_structure as Record<string, unknown>)
      : {}
  return { ...s, playoff_structure: { ...structure, championship_length: championshipLength } }
}

/** Null when the change fits (or does not move the final later); the overrun otherwise. */
export async function playoffFitOverflow(
  input: { league: LeagueForFit; change: PlayoffFitChange },
  deps: { prisma?: PrismaClient } = {},
): Promise<PlayoffFitOverflow | null> {
  const db = deps.prisma ?? (defaultPrisma as unknown as PrismaClient)
  const { league, change } = input
  const pick = <T,>(next: T | null | undefined, current: T | null | undefined) => (next !== undefined ? next : current)

  const currentLength = readChampionshipLength(league.settings)
  const nextLength = pick(change.championshipLength, currentLength) ?? null
  const nextTeams = Number(pick(change.playoffTeams, league.playoffTeams) ?? 0)
  const currentTeams = Number(league.playoffTeams ?? 0)
  const nextPerRound = pick(change.playoffWeeksPerRound, league.playoffWeeksPerRound)

  const season = await db.redraftSeason.findFirst({
    where: { leagueId: league.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, totalWeeks: true, playoffStartWeek: true },
  })

  let nextRounds: number
  let currentRounds: number
  let nextStart: number
  let currentStart: number
  let seasonWeeks: number
  let basis: PlayoffFitOverflow['basis']
  let teamsDecideRounds = true

  if (season) {
    const finalRound = await db.redraftPlayoffRound.findFirst({
      where: { seasonId: season.id, roundNumber: CHAMPIONSHIP_ROUND_WHERE },
      orderBy: { roundNumber: 'desc' },
      select: { roundNumber: true },
    })
    teamsDecideRounds = finalRound == null
    nextRounds = finalRound?.roundNumber ?? playoffRoundsForTeams(nextTeams)
    currentRounds = finalRound?.roundNumber ?? playoffRoundsForTeams(currentTeams)
    // The season stores its own start week; a start week saved in this request is what the bracket
    // will be built from.
    currentStart = season.playoffStartWeek
    nextStart = change.playoffStartWeek != null ? Number(change.playoffStartWeek) : season.playoffStartWeek
    seasonWeeks = season.totalWeeks
    basis = 'season'
  } else {
    // The season `ensureRedraftSeason` would create — sized with the NEW settings, as creation would.
    const cfg = tryGetSportConfig(leagueSportToConfigSport(String(league.sport ?? 'NFL')))
    const dynastyConfig =
      league.dynastyConfig !== undefined
        ? league.dynastyConfig
        : ((await db.league.findUnique({
            where: { id: league.id },
            select: { dynastyConfig: { select: { regularSeasonWeeks: true } } },
          })) as { dynastyConfig?: { regularSeasonWeeks: number } | null } | null)?.dynastyConfig ?? null
    seasonWeeks = resolveCreatedSeasonWeeks(
      {
        ...league,
        dynastyConfig,
        playoffTeams: nextTeams,
        playoffWeeksPerRound: nextPerRound,
        settings: withChampionshipLength(league.settings, nextLength),
      },
      cfg?.defaultSeasonWeeks ?? 17,
    )
    const startCap = league.leagueType !== undefined ? maxPlayoffStartWeekFor(league) : null
    const startFor = (raw: unknown) => {
      const n = Number(raw)
      return Number.isInteger(n) && n >= 2 && n <= seasonWeeks && (startCap == null || n <= startCap)
        ? n
        : Math.min(cfg?.defaultPlayoffStartWeek ?? 15, startCap ?? Infinity)
    }
    currentStart = startFor(league.playoffStartWeek)
    nextStart = startFor(pick(change.playoffStartWeek, league.playoffStartWeek))
    nextRounds = playoffRoundsForTeams(nextTeams)
    currentRounds = playoffRoundsForTeams(currentTeams)
    basis = 'creation'
  }
  if (nextRounds < 1) return null

  const lastWeek = (start: number, rounds: number, perRound: number | null | undefined, length: number | null) =>
    rounds < 1
      ? 0
      : lastWeekOfPlayoffRound({
          playoffStartWeek: start,
          roundNumber: rounds,
          weeksPerRound: perRound,
          finalRoundNumber: rounds,
          championshipLength: length,
        })
  const next = lastWeek(nextStart, nextRounds, nextPerRound, nextLength)
  const current = lastWeek(currentStart, currentRounds, league.playoffWeeksPerRound, currentLength)
  if (next <= seasonWeeks || next <= current) return null
  return {
    lastPlayoffWeek: next,
    seasonWeeks,
    basis,
    playoffStartWeek: nextStart,
    maxPlayoffTeams: maxPlayoffTeamsThatFit({
      seasonWeeks,
      playoffStartWeek: nextStart,
      weeksPerRound: nextPerRound,
      championshipLength: nextLength,
      leagueSize: league.leagueSize,
    }),
    teamsDecideRounds,
  }
}

export function playoffFitOverflowMessage(o: PlayoffFitOverflow): string {
  const head = `Those playoff settings would end the final in week ${o.lastPlayoffWeek}, past the season's last week (${o.seasonWeeks}).`
  if (!o.teamsDecideRounds) return `${head} Shorten the final or the rounds, or move the playoffs earlier.`
  if (o.maxPlayoffTeams >= 2) {
    return `${head} With playoffs starting in week ${o.playoffStartWeek}, at most ${o.maxPlayoffTeams} playoff teams fit — choose ${o.maxPlayoffTeams} or fewer, shorten the rounds or the final, or move the playoffs earlier.`
  }
  return `${head} No bracket fits with playoffs starting in week ${o.playoffStartWeek} — move the playoffs earlier or shorten the rounds or the final.`
}

/** Null when the new length fits (or does not move the final later); the overrun otherwise. */
export function championshipLengthOverflow(
  input: { league: LeagueForFit; championshipLength: number },
  deps: { prisma?: PrismaClient } = {},
): Promise<ChampionshipLengthOverflow | null> {
  return playoffFitOverflow({ league: input.league, change: { championshipLength: input.championshipLength } }, deps)
}

export function championshipLengthOverflowMessage(o: ChampionshipLengthOverflow): string {
  return playoffFitOverflowMessage(o)
}
