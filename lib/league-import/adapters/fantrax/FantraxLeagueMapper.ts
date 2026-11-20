import { readFantraxDivisions, STANDINGS_DIVISIONS_KEY } from '@/lib/league-import/standingsDivisions'
import { GAMES_PER_WEEK_SETTINGS_KEY, inferGamesPerWeek, MAX_GAMES_PER_WEEK } from '@/lib/schedule-runtime/gamesPerWeek'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { usesFantraxPeriodCalendar } from '@/lib/league-import/fantrax/fantraxProSports'
import type { IExternalLeagueMapper } from '../../mappers/ExternalLeagueMapper'
import type { NormalizedLeagueSettings } from '../../types'
import type { FantraxImportPayload } from './types'
import type { FantraxPlayoffs } from '../../fantrax/fantraxApi'

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

export const FantraxLeagueMapper: IExternalLeagueMapper<FantraxImportPayload> = {
  map(source) {
    const gamesPerWeek = Math.min(MAX_GAMES_PER_WEEK, inferGamesPerWeek(
      source.schedule.flatMap((week) => week.matchups
        .filter((matchup) => !matchup.isPlayoff)
        .map((matchup) => ({ week: week.week, homeRosterId: matchup.teamId2, awayRosterId: matchup.teamId1 }))),
    ))
    const inferredScoring =
      source.settings?.scoringType ??
      (source.league.isDevy ? 'devy' : source.league.sport === 'NCAAF' ? 'college' : null)
    const seasonState = source.settings?.raw?.seasonState
    const calendar = source.settings?.raw
    const playoffs = calendar?.playoffs as FantraxPlayoffs | null | undefined
    const playoffStart = playoffs?.used === true ? positiveInteger(playoffs.firstPlayoffPeriod) : undefined
    const playoffTeams = playoffs?.used === false ? 0
      : playoffs?.used === true ? positiveInteger(playoffs.numPlayoffTeams) : undefined
    const regularPeriods = positiveInteger(playoffs?.lastRegularSeasonPeriod) ??
      (playoffStart ? playoffStart - 1 : undefined)
    const hasLiveSeasonState = seasonState === 'preseason' || seasonState === 'in_progress' || seasonState === 'complete'
    const hasRosteredPlayers = source.teams.some((team) => team.rosterPlayerIds.length > 0)
    const isPreDraft = hasLiveSeasonState && seasonState !== 'complete' &&
      !hasRosteredPlayers && source.draftPicks.length === 0

    return {
      name: source.league.name,
      sport: normalizeToSupportedSport(source.league.sport),
      season: source.league.season,
      leagueSize: source.league.size,
      /*
       * ⚠ THE FETCH SERVICE NOW STATES THE REAL PER-TEAM SIZE, and this used to
       * derive it by summing `rosterPositions` — which was a census of the whole
       * league's player pool, so the sum was 466 on a 12-team league. Summing an
       * empty list would now yield 0, which is a different wrong answer; the
       * stated size is preferred and null is left as null rather than becoming a
       * confident zero.
       */
      rosterSize: source.settings?.rosterSize ?? null,
      scoring: inferredScoring,
      isDynasty: source.league.isDevy,
      // Same fix as Sleeper/ESPN/Yahoo/MFL: `League.status` has no DB default,
      // so a missing value here leaves imported leagues invisible on Dashboard.
      // A live league with no rostered players or made picks has not drafted yet.
      // Preserve the old status behavior for CSV snapshots, which lack a live season state.
      status: source.league.isFinished || seasonState === 'complete'
        ? 'complete'
        : isPreDraft
          ? 'pre_draft'
          : seasonState === 'preseason'
            ? 'off_season'
            : 'in_season',
      playoff_team_count: playoffTeams,
      playoff_teams: playoffTeams,
      playoff_start_week: playoffStart,
      regular_season_length: regularPeriods ?? (source.schedule.length || undefined),
      ...(positiveInteger(calendar?.lastPeriod) || usesFantraxPeriodCalendar(source.league.sport)
        ? { current_week: source.league.currentWeek ?? undefined } : {}),
      schedule_unit: 'week',
      matchup_frequency: 'head_to_head',
      waiver_type: undefined,
      faab_budget: null,
      roster_positions: source.settings?.rosterPositions.map((slot) => `${slot.position}:${slot.count}`) ?? [],
      fantrax_settings: source.settings?.raw ?? null,
      // How many games each team plays in a week (Fantrax leagues can play 3 or 5), read from the
      // schedule itself. Only set above 1, so an ordinary league's settings are untouched.
      ...(gamesPerWeek > 1 ? { [GAMES_PER_WEEK_SETTINGS_KEY]: gamesPerWeek } : {}),
      // Divisions were dropped until 2026-11-18. `null` clears a stale key, as for Sleeper and ESPN.
      [STANDINGS_DIVISIONS_KEY]: readFantraxDivisions((source.settings?.raw as { divisionByTeamId?: Record<string, string> } | null | undefined)?.divisionByTeamId),
    } satisfies NormalizedLeagueSettings
  },
}
