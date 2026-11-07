/**
 * The live create wizard's Best Ball choices (Classic Best Ball), as pure functions so the panel,
 * the review summary and the tests read one implementation.
 *
 * Every choice writes the `state.bestBall` fields `normalizeBestBallSettings` (lib/bestball/rules.ts)
 * already reads, so it travels unchanged through submit.ts -> POST /api/leagues ->
 * createCanonicalLeagueInTransaction and is saved as `settings.best_ball_settings`. Before this the
 * wizard had no Best Ball controls at all: every league got the sport defaults.
 *
 * Rules respected here rather than discovered at submit (validateCreateLeague.ts):
 *  - a tournament scores weekly ("Tournament advancement currently requires weekly scoring");
 *  - an NFL tournament ends by week 18;
 *  - more than one pod needs an advancement round.
 * Daily scoring is offered for NBA / NHL / MLB only and never for a tournament. It is saved as
 * `best_ball_settings.scoringPeriod`; the daily scorer itself is separate work.
 */
import type { CreateLeagueV2State, BestBallSetupState } from '@/lib/create-league-v2/state'
import { ncaafPlayoffWindow } from '@/lib/league-defaults/ncaafPlayoffWindow'

export type BestBallCompetition = 'season_total' | 'h2h' | 'tournament'
export type BestBallScoringPeriodChoice = 'weekly' | 'daily'

/** Every fantasy week a sport's season has (lib/sportConfig/configs/*.ts `defaultSeasonWeeks`). */
export const BEST_BALL_FULL_SEASON_WEEKS: Record<CreateLeagueV2State['sport'], number> = {
  NFL: 17,
  NCAAF: 13,
  NBA: 25,
  NHL: 28,
  MLB: 27,
  NCAAB: 18,
  SOCCER: 38,
}

const DAILY_SPORTS = new Set<string>(['NBA', 'NHL', 'MLB'])
const TOURNAMENT_SPORTS = new Set<string>(['NFL', 'NCAAF'])
const PLAYOFF_TEAM_CHOICES = [2, 4, 6, 8] as const
const MIN_TWO_POD_FIELD = 8

export function bestBallCompetitionOf(bb: Pick<BestBallSetupState, 'contestStructure' | 'tournamentEnabled' | 'matchupFormat' | 'cumulativeScoring'>): BestBallCompetition {
  if (bb.tournamentEnabled || bb.contestStructure === 'tournament') return 'tournament'
  return bb.matchupFormat === 'h2h' && !bb.cumulativeScoring ? 'h2h' : 'season_total'
}

export function bestBallDailyAvailable(sport: string): boolean {
  return DAILY_SPORTS.has(sport)
}

export function bestBallTournamentAvailable(sport: string): boolean {
  return TOURNAMENT_SPORTS.has(sport)
}

export function bestBallHasPlayoffs(bb: Pick<BestBallSetupState, 'playoffFormat' | 'playoffTeams'>): boolean {
  return bb.playoffFormat !== 'none' && bb.playoffTeams > 0
}

/** Playoff sizes this league can seat: none, then even brackets no bigger than the league. */
export function bestBallPlayoffTeamChoices(teamCount: number): number[] {
  return [0, ...PLAYOFF_TEAM_CHOICES.filter((n) => n <= teamCount)]
}

/**
 * Leagues seat 4–16 teams, so a tournament is two even pods from 8 teams up (each pod's top scorer
 * meets in a final round) and one pod below that. More than one pod needs an advancement round
 * (validateCreateLeague.ts).
 */
function tournamentShape(teamCount: number): Pick<BestBallSetupState, 'podSize' | 'tournamentAdvancementRounds' | 'advancersPerPod'> {
  const teams = Math.max(2, Math.floor(teamCount))
  const podSize = teams >= MIN_TWO_POD_FIELD ? Math.ceil(teams / 2) : teams
  return { podSize, tournamentAdvancementRounds: teams > podSize ? 1 : 0, advancersPerPod: 1 }
}

/**
 * The new `bestBall` block for a competition format. `defaults` is the sport's untouched default
 * block (getDefaultBestBallSetup), used to restore a regular season after leaving "no playoffs".
 */
export function withBestBallCompetition(
  bb: BestBallSetupState,
  competition: BestBallCompetition,
  ctx: { sport: CreateLeagueV2State['sport']; teamCount: number; defaults: BestBallSetupState },
): BestBallSetupState {
  if (competition === 'tournament') {
    return {
      ...bb,
      ...tournamentShape(ctx.teamCount),
      contestStructure: 'tournament',
      tournamentEnabled: true,
      sitAndGoEnabled: false,
      matchupFormat: 'cumulative',
      cumulativeScoring: true,
      playoffFormat: 'advancement',
      playoffTeams: 0,
      // A tournament scores weekly — daily is never offered for one.
      scoringPeriod: 'weekly',
      regularSeasonLength: ctx.defaults.regularSeasonLength,
      roundEndWeeks: undefined,
      finalRoundStructure: 'cumulative_final',
    }
  }
  const leavingTournament = bestBallCompetitionOf(bb) === 'tournament'
  const base: BestBallSetupState = {
    ...bb,
    contestStructure: 'season_long',
    tournamentEnabled: false,
    sitAndGoEnabled: false,
    tournamentAdvancementRounds: 0,
    roundEndWeeks: undefined,
    ...(leavingTournament
      ? { playoffTeams: Math.min(ctx.defaults.playoffTeams, ctx.teamCount), regularSeasonLength: ctx.defaults.regularSeasonLength }
      : {}),
  }
  const cumulative = competition === 'season_total'
  const playoffs = bestBallHasPlayoffs({ playoffFormat: leavingTournament ? 'bracket' : base.playoffFormat, playoffTeams: base.playoffTeams })
  return {
    ...base,
    matchupFormat: cumulative ? 'cumulative' : 'h2h',
    cumulativeScoring: cumulative,
    playoffFormat: playoffs ? (cumulative ? 'advancement' : 'bracket') : 'none',
    finalRoundStructure: cumulative ? 'cumulative_final' : 'single_week_final',
  }
}

/**
 * Playoff teams (0 = no playoffs). No playoffs plays the whole season as the regular season and
 * crowns its leader (lib/bestball/noPlayoffSeason.ts); turning playoffs back on restores the sport's
 * regular season so the bracket has weeks to be played in.
 */
export function withBestBallPlayoffTeams(
  bb: BestBallSetupState,
  playoffTeams: number,
  ctx: { sport: CreateLeagueV2State['sport']; defaults: BestBallSetupState },
): BestBallSetupState {
  if (playoffTeams <= 0) {
    return { ...bb, playoffTeams: 0, playoffFormat: 'none', regularSeasonLength: BEST_BALL_FULL_SEASON_WEEKS[ctx.sport] }
  }
  const cumulative = bb.matchupFormat === 'cumulative' || bb.cumulativeScoring
  return {
    ...bb,
    playoffTeams,
    playoffFormat: cumulative ? 'advancement' : 'bracket',
    // Coming back from no playoffs: the sport's regular season, so the bracket has weeks to be played in.
    regularSeasonLength: bestBallHasPlayoffs(bb) ? bb.regularSeasonLength : ctx.defaults.regularSeasonLength,
  }
}

/** The block refitted to a new league size: the bracket never seats more teams, and pods are re-cut. */
export function fitBestBallToTeamCount(bb: BestBallSetupState, teamCount: number): BestBallSetupState {
  if (bestBallCompetitionOf(bb) === 'tournament') return { ...bb, ...tournamentShape(teamCount) }
  return { ...bb, playoffTeams: Math.min(bb.playoffTeams, Math.max(0, teamCount)) }
}

export function withBestBallScoringPeriod(bb: BestBallSetupState, period: BestBallScoringPeriodChoice, sport: string): BestBallSetupState {
  const allowed = period === 'daily' && bestBallDailyAvailable(sport) && bestBallCompetitionOf(bb) !== 'tournament'
  // The tie rule follows the period, as the sport defaults pair them (rules.ts getDefaultBestBallSettings).
  return { ...bb, scoringPeriod: allowed ? 'daily' : 'weekly', tieRule: allowed ? 'points_for' : 'max_week' }
}

/** Waivers / free agency on = "managed Best Ball"; off = draft-only (the default). */
export function withBestBallWaivers(bb: BestBallSetupState, enabled: boolean): BestBallSetupState {
  return { ...bb, waiversEnabled: enabled }
}

export type BestBallRulesLine = { id: 'lineups' | 'transactions' | 'season' | 'champion'; label: string; text: string }

function weeksLabel(from: number, to: number): string {
  return from === to ? `week ${from}` : `weeks ${from}–${to}`
}

/** The season as the server will save it (NCAAF brackets end on week 13 — ncaafPlayoffWindow.ts). */
export function bestBallSeasonShape(bb: BestBallSetupState, sport: CreateLeagueV2State['sport'], teamCount: number) {
  if (bestBallCompetitionOf(bb) === 'tournament') {
    const shape = tournamentShape(teamCount)
    const rounds = shape.tournamentAdvancementRounds
    const ends = Array.from({ length: rounds + 1 }, (_, i) => bb.regularSeasonLength + i)
    return { regularSeasonEnd: bb.regularSeasonLength, playoffStart: null as number | null, lastWeek: ends.at(-1)!, roundEnds: ends }
  }
  if (!bestBallHasPlayoffs(bb)) {
    return { regularSeasonEnd: bb.regularSeasonLength, playoffStart: null as number | null, lastWeek: bb.regularSeasonLength, roundEnds: [] as number[] }
  }
  const teams = Math.min(bb.playoffTeams, teamCount)
  if (sport === 'NCAAF') {
    const window = ncaafPlayoffWindow(teams)
    if (window) return { regularSeasonEnd: window.regularSeasonEndWeek, playoffStart: window.playoffStartWeek, lastWeek: window.championshipWeek, roundEnds: [] as number[] }
  }
  const rounds = Math.max(1, Math.ceil(Math.log2(Math.max(2, teams))))
  return { regularSeasonEnd: bb.regularSeasonLength, playoffStart: bb.regularSeasonLength + 1, lastWeek: bb.regularSeasonLength + rounds, roundEnds: [] as number[] }
}

/** The plain-language rules the review step shows. */
export function bestBallRulesSummary(bb: BestBallSetupState, sport: CreateLeagueV2State['sport'], teamCount: number): BestBallRulesLine[] {
  const competition = bestBallCompetitionOf(bb)
  const period = bb.scoringPeriod === 'daily' ? 'day' : 'week'
  const shape = bestBallSeasonShape(bb, sport, teamCount)
  const lines: BestBallRulesLine[] = [
    {
      id: 'lineups',
      label: 'Lineups',
      text: `Set automatically every ${period}: each team scores its best possible lineup from the players it rostered. Nobody sets a lineup.`,
    },
    {
      id: 'transactions',
      label: 'Transactions',
      text: bb.waiversEnabled
        ? `Managed Best Ball: waivers and free agency are open all season${bb.tradesEnabled ? ', and trades are allowed' : '; trades are off'}.`
        : `Draft only: no waivers, no free agency${bb.tradesEnabled ? '' : ', no trades'}. The team you draft is the team you play.`,
    },
  ]
  if (competition === 'tournament') {
    const tShape = tournamentShape(teamCount)
    const roundText = shape.roundEnds.map((w, i) => (i === 0 ? `round 1 ends week ${w}` : `round ${i + 1} is week ${w}`)).join(', ')
    lines.push(
      { id: 'season', label: 'Season', text: `${weeksLabel(1, shape.lastWeek)[0].toUpperCase()}${weeksLabel(1, shape.lastWeek).slice(1)}, scored weekly: ${roundText}.` },
      {
        id: 'champion',
        label: 'Champion',
        text: shape.roundEnds.length > 1
          ? `Pods of ${tShape.podSize}: the top ${bb.advancersPerPod ?? 1} in total points from each pod advance each round, and the highest total in the final round wins.`
          : `The most total points through week ${shape.lastWeek} wins.`,
      },
    )
    return lines
  }
  if (shape.playoffStart == null) {
    lines.push(
      { id: 'season', label: 'Season', text: `${weeksLabel(1, shape.regularSeasonEnd)[0].toUpperCase()}${weeksLabel(1, shape.regularSeasonEnd).slice(1)} (${shape.regularSeasonEnd} weeks), no playoffs.` },
      {
        id: 'champion',
        label: 'Champion',
        text: competition === 'h2h'
          ? `The best head-to-head record after week ${shape.regularSeasonEnd} wins; total points break a tie.`
          : `The team with the most total points after week ${shape.regularSeasonEnd} wins.`,
      },
    )
    return lines
  }
  const teams = Math.min(bb.playoffTeams, teamCount)
  lines.push(
    {
      id: 'season',
      label: 'Season',
      text: `Regular season ${weeksLabel(1, shape.regularSeasonEnd)}, then playoffs ${weeksLabel(shape.playoffStart, shape.lastWeek)}.`,
    },
    {
      id: 'champion',
      label: 'Champion',
      text: competition === 'h2h'
        ? `The top ${teams} by record (points break ties) make the playoffs; the bracket winner is champion.`
        : `The top ${teams} in total points make the playoffs; the playoff winner is champion.`,
    },
  )
  return lines
}
