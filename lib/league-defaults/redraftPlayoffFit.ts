/**
 * A redraft league's default playoff shape — field size, byes, rounds and start week — sized so the
 * final lands in the season's last week. NFL, NBA, NHL and MLB, every league size from 4 to 20.
 *
 * 🛑 THREE THINGS USED TO DISAGREE AND THE SEASON PAID FOR ALL OF THEM.
 *  - The start week was the sport's 6-team default (NFL 15, NBA 23, NHL 25, MLB 24) whatever the
 *    bracket size, so a 4-team bracket crowned its champion a week early and the last week went
 *    unplayed (playoffFit.ts).
 *  - Daily sports seeded a flat 6, so a 6-team NBA/NHL/MLB league sent every team to the playoffs.
 *    They now take the NFL's size-aware rule, `derivePlayoffTeams` (4 under ten teams, 6 from ten).
 *  - Creation wrote the `League.playoffTeams` column clamped (4) while three JSON copies kept the
 *    registry's 6 teams / 2 byes / 3 rounds, and the standings and Season Outlook read the JSON.
 *    `applyPlayoffShapeToSettings` writes the one shape into every copy.
 *
 * Only creation and a pre-draft resize use this. A commissioner's own choice is never re-derived.
 */

import { derivePlayoffTeams } from '@/lib/league-concepts/redraftDefaults'
import { tryGetSportConfig } from '@/lib/sportConfig'
import { resolveDefaultPlayoffConfig } from '@/lib/sport-defaults/DefaultPlayoffConfigResolver'
import type { SportType } from '@/lib/sport-defaults/types'
import {
  MAX_PLAYOFF_TEAMS,
  firstRoundByesForTeams,
  fittedPlayoffStartWeek,
  playoffBracketWeeks,
  playoffRoundsForTeams,
} from '@/lib/playoff-runtime/playoffFit'

export const REDRAFT_PLAYOFF_FIT_SPORTS: ReadonlySet<string> = new Set(['NFL', 'NBA', 'NHL', 'MLB'])

export type RedraftPlayoffShape = {
  playoffTeams: number
  firstRoundByes: number
  totalRounds: number
  playoffStartWeek: number
  regularSeasonEndWeek: number
  /** The final's last week — the season's last week. */
  championshipWeek: number
  /** Weeks the bracket is played over, the final included. */
  playoffWeeks: number
  seasonWeeks: number
}

function seasonWeeksFor(sport: string): number | null {
  const weeks = tryGetSportConfig(sport)?.defaultSeasonWeeks
  return Number.isInteger(weeks) && Number(weeks) >= 2 ? Number(weeks) : null
}

/** Even, at least 2, at most the league and MAX_PLAYOFF_TEAMS — the creation clamp. */
function fitTeams(requested: number, leagueSize: number): number {
  const seats = Math.max(2, Math.floor(leagueSize) || 2)
  const fitted = Math.max(2, Math.min(Math.floor(requested), seats, MAX_PLAYOFF_TEAMS))
  return fitted % 2 === 0 ? fitted : fitted - 1
}

/**
 * The default shape for a redraft league of `leagueSize`, or null for a sport this does not size.
 * `playoffTeams` overrides the size-derived field (already clamped by the caller).
 */
export function redraftPlayoffShapeFor(input: {
  sport: string
  leagueSize: number
  playoffTeams?: number | null
  weeksPerRound?: number | null
  championshipLength?: number | null
}): RedraftPlayoffShape | null {
  const sport = String(input.sport ?? '').toUpperCase()
  if (!REDRAFT_PLAYOFF_FIT_SPORTS.has(sport)) return null
  const seasonWeeks = seasonWeeksFor(sport)
  if (seasonWeeks == null) return null
  const requested = input.playoffTeams != null && Number(input.playoffTeams) >= 2 ? Number(input.playoffTeams) : derivePlayoffTeams(input.leagueSize)
  const playoffTeams = fitTeams(requested, input.leagueSize)
  const championshipLength =
    input.championshipLength ?? resolveDefaultPlayoffConfig(sport as SportType).championship_length ?? null
  const shape = { teams: playoffTeams, weeksPerRound: input.weeksPerRound, championshipLength }
  const playoffStartWeek = fittedPlayoffStartWeek({ ...shape, seasonWeeks })
  if (playoffStartWeek == null) return null
  return {
    playoffTeams,
    firstRoundByes: firstRoundByesForTeams(playoffTeams),
    totalRounds: playoffRoundsForTeams(playoffTeams),
    playoffStartWeek,
    regularSeasonEndWeek: playoffStartWeek - 1,
    championshipWeek: seasonWeeks,
    playoffWeeks: playoffBracketWeeks(shape),
    seasonWeeks,
  }
}

/**
 * The (team count, start week) pairs a league of `leagueSize` would hold if nobody had touched them:
 * today's creation rule, and the rule leagues were created with before it (NFL size-aware teams /
 * daily-sport flat 6, both clamped to the league, and the sport's fixed default start week).
 */
export function untouchedRedraftPlayoffDefaults(input: {
  sport: string
  leagueSize: number
  weeksPerRound?: number | null
  championshipLength?: number | null
}): Array<{ playoffTeams: number; playoffStartWeek: number }> {
  const sport = String(input.sport ?? '').toUpperCase()
  const out: Array<{ playoffTeams: number; playoffStartWeek: number }> = []
  const current = redraftPlayoffShapeFor(input)
  if (current) out.push({ playoffTeams: current.playoffTeams, playoffStartWeek: current.playoffStartWeek })
  const legacyStart = tryGetSportConfig(sport)?.defaultPlayoffStartWeek
  if (REDRAFT_PLAYOFF_FIT_SPORTS.has(sport) && Number.isInteger(legacyStart)) {
    const legacyTeams = sport === 'NFL' ? derivePlayoffTeams(input.leagueSize) : fitTeams(6, input.leagueSize)
    out.push({ playoffTeams: legacyTeams, playoffStartWeek: Number(legacyStart) })
  }
  return out
}

function obj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/**
 * Write one shape into every JSON copy of it in `League.settings`: the flat `playoff_team_count`, the
 * `playoffSettings` block, `playoff_structure`, and `foundation_defaults.playoff`. Returns new objects;
 * copies that are absent are created only where a reader would otherwise fall back to the registry's 6.
 */
export function applyPlayoffShapeToSettings(
  settings: Record<string, unknown>,
  shape: RedraftPlayoffShape,
): Record<string, unknown> {
  const both = {
    playoffTeams: shape.playoffTeams,
    playoff_team_count: shape.playoffTeams,
    firstRoundByes: shape.firstRoundByes,
    first_round_byes: shape.firstRoundByes,
    totalRounds: shape.totalRounds,
    total_rounds: shape.totalRounds,
    playoffStartWeek: shape.playoffStartWeek,
    playoff_start_week: shape.playoffStartWeek,
    regularSeasonEndWeek: shape.regularSeasonEndWeek,
    regular_season_end_week: shape.regularSeasonEndWeek,
    championshipWeek: shape.championshipWeek,
    championship_week: shape.championshipWeek,
    playoffWeeks: shape.playoffWeeks,
    playoff_weeks: shape.playoffWeeks,
  }
  const next: Record<string, unknown> = { ...settings, playoff_team_count: shape.playoffTeams }
  next.playoffSettings = { ...(obj(settings.playoffSettings) ?? {}), ...both }
  next.playoff_structure = {
    ...(obj(settings.playoff_structure) ?? {}),
    playoff_team_count: shape.playoffTeams,
    first_round_byes: shape.firstRoundByes,
    total_rounds: shape.totalRounds,
    playoff_start_week: shape.playoffStartWeek,
    playoff_weeks: shape.playoffWeeks,
  }
  const foundation = obj(settings.foundation_defaults)
  const foundationPlayoff = obj(foundation?.playoff)
  if (foundation && foundationPlayoff) {
    next.foundation_defaults = { ...foundation, playoff: { ...foundationPlayoff, ...both } }
  }
  return next
}

/**
 * The playoff columns a pre-draft resize should write, or null to leave them alone.
 *
 * A league whose field and start week are still the defaults for its OLD size — by today's rule or the
 * one it was created under — is re-derived for the new size: a 10-team NFL league cut to 8 drops from
 * 6 playoff teams starting week 15 to 4 starting week 16. Anything else is a commissioner's choice and
 * is kept, only clamped so the field never exceeds the league. ⚠ There is no provenance for these
 * columns, so a commissioner who deliberately chose exactly the default is treated as untouched; the
 * result is the default for the new size, which is what an untouched league gets.
 */
export function resizedPlayoffColumns(input: {
  sport: string
  leagueType?: string | null
  settings?: unknown
  oldSize: number
  newSize: number
  playoffTeams?: number | null
  playoffStartWeek?: number | null
  weeksPerRound?: number | null
  championshipLength?: number | null
}): { playoffTeams?: number; playoffStartWeek?: number } | null {
  const teams = Number(input.playoffTeams)
  if (!Number.isInteger(teams) || teams < 2) return null
  const roto = (obj(input.settings)?.scoring_mode ?? null) === 'roto'
  if (String(input.leagueType ?? '').toLowerCase() === 'redraft' && !roto) {
    const shapeArgs = { sport: input.sport, weeksPerRound: input.weeksPerRound, championshipLength: input.championshipLength }
    const untouched = untouchedRedraftPlayoffDefaults({ ...shapeArgs, leagueSize: input.oldSize }).some(
      (d) => d.playoffTeams === teams && d.playoffStartWeek === input.playoffStartWeek,
    )
    const next = untouched ? redraftPlayoffShapeFor({ ...shapeArgs, leagueSize: input.newSize }) : null
    if (next) return { playoffTeams: next.playoffTeams, playoffStartWeek: next.playoffStartWeek }
  }
  if (teams <= input.newSize) return null
  return { playoffTeams: fitTeams(teams, input.newSize) }
}
