/**
 * The redraft "season race" deck on /core's league Home (batch B-ID, 2026-10-31).
 *
 * /core's Home renders only for IMPORTED leagues — a native league redirects to /league/[id] before
 * any home read — so this is what an imported redraft league (lib/league-media/redraftIdentity.ts
 * `isImportedRedraftLeague`) shows above the existing Home panels: the season track, a broadcast score
 * bug for the viewer's game, the playoff race with its line, and last week's recap.
 *
 * 🛑 REAL DATA ONLY, AND EVERY PIECE DROPS RATHER THAN GUESSES. Each block is built from something the
 * Home loader already read for the panels below it (standings, the scoreboard, League.settings) plus,
 * for the recap, the previous week's scoreboard from the same WeeklyMatchup rows. A block whose input
 * is missing is null and the screen renders nothing for it:
 *   - the track's markers are `buildRedraftSeasonTrack`'s, which drop a missing week; there is no
 *     `totalWeeks` for an import (nothing stores where its playoffs END), so the track is the marker
 *     list without a bar, and "Week 9 of 14" is said only of the REGULAR season, which is stored;
 *   - the score bug needs the viewer's own game on the scoreboard; an unplayed week shows projections
 *     labelled as projections, never as a score;
 *   - the playoff race needs the league's own playoff team count (`playoffSpots`), fewer spots than
 *     teams, and at least one decided game — no stated count, no line;
 *   - the recap needs a week BEFORE the current one in which every game has both scores.
 *
 * Pure and client-safe (types only from the server modules), so the mapping is unit-tested without a
 * database.
 */
import type { RedraftSeasonFacts } from '@/lib/league-media/redraftSeasonTrack'
import type { RedraftIdentity } from '@/lib/league-media/redraftIdentity'
import type { LeagueScoreboard, ScoreboardGame, ScoreboardTeam } from './leagueScoreboard'
import { playoffSpots, playoffStartWeek, regularSeasonWeeks, tradeDeadlineWeek } from './seasonTimeline'

export type RedraftDeckSide = {
  name: string
  record: string | null
  avatarUrl: string | null
  /** Real points once the week is scored; null before. */
  points: number | null
  /** Projected total under league scoring; shown only while `points` is null. */
  projected: number | null
  isYou: boolean
}

export type RedraftScoreBug = {
  week: number
  /** `final`: a week before the current one. `scored`: the current week has points. `upcoming`: none yet. */
  state: 'final' | 'scored' | 'upcoming'
  you: RedraftDeckSide
  opponent: RedraftDeckSide
  /** The viewer's chance, 0–100, from the scoreboard's own model; null when it has none. */
  winPct: number | null
}

export type RedraftRaceRow = {
  rank: number
  teamName: string
  record: string
  isYou: boolean
  /** Inside the playoff line. */
  inLine: boolean
}

export type RedraftPlayoffRace = { spots: number; rows: RedraftRaceRow[] }

export type RedraftRecap = {
  week: number
  topScore: { team: string; points: number }
  closest: { winner: string; loser: string; margin: number } | null
  biggestWin: { winner: string; loser: string; margin: number } | null
}

export type RedraftHomeDeck = RedraftIdentity & {
  track: RedraftSeasonFacts
  /** The track head's fallback when there is no week yet ("pre_draft" → "Before the draft"). */
  phaseLabel: string
  /** The regular season as stored: week N of M. Null unless both are known and N ≤ M. */
  regularSeason: { week: number; of: number } | null
  scoreBug: RedraftScoreBug | null
  playoffRace: RedraftPlayoffRace | null
  recap: RedraftRecap | null
}

export type RedraftStandingInput = {
  teamName: string
  wins: number
  losses: number
  ties: number
  rank: number | null
  isYou: boolean
}

export type BuildRedraftHomeDeckInput = {
  identity: RedraftIdentity
  settings: unknown
  currentWeek: number | null
  stage: string | null
  preSeason: boolean
  standings: RedraftStandingInput[] | null
  /** The scoreboard Home is showing (the current week unless the viewer picked one). */
  board: LeagueScoreboard | null
  /** The week before `currentWeek`, read only for the recap. */
  lastWeekBoard: LeagueScoreboard | null
}

const recordOf = (s: Pick<RedraftStandingInput, 'wins' | 'losses' | 'ties'>) =>
  s.ties > 0 ? `${s.wins}–${s.losses}–${s.ties}` : `${s.wins}–${s.losses}`

const nameOf = (t: ScoreboardTeam) => t.teamName?.trim() || t.managerName?.trim() || 'Team'

function phaseLabel(stage: string | null): string {
  switch ((stage ?? '').toLowerCase()) {
    case 'pre_draft':
    case 'predraft':
    case 'setup':
      return 'Before the draft'
    case 'drafting':
    case 'draft':
      return 'Draft day'
    case 'complete':
    case 'completed':
      return 'Season complete'
    default:
      return 'In season'
  }
}

function buildScoreBug(
  board: LeagueScoreboard | null,
  currentWeek: number | null,
  standings: RedraftStandingInput[] | null,
): RedraftScoreBug | null {
  if (!board) return null
  const game = board.games.find(g => g.teams.length === 2 && g.teams.some(t => t.isYou))
  if (!game) return null
  const youIndex = game.teams[0].isYou ? 0 : 1
  const you = game.teams[youIndex]
  const opp = game.teams[1 - youIndex]
  const recordFor = (team: ScoreboardTeam): string | null => {
    const name = nameOf(team)
    const hit = standings?.filter(s => (team.isYou ? s.isYou : s.teamName === name)) ?? []
    return hit.length === 1 ? recordOf(hit[0]) : null
  }
  const scored = !game.unplayed && you.points != null && opp.points != null
  const side = (team: ScoreboardTeam): RedraftDeckSide => ({
    name: nameOf(team),
    record: recordFor(team),
    avatarUrl: team.avatarUrl,
    points: scored ? team.points : null,
    projected: scored ? null : team.projected,
    isYou: team.isYou,
  })
  const p = game.winProbability
  const winPct = p == null || !Number.isFinite(p) ? null : Math.round((youIndex === 0 ? p : 1 - p) * 100)
  return {
    week: board.week,
    state: !scored ? 'upcoming' : currentWeek != null && board.week < currentWeek ? 'final' : 'scored',
    you: side(you),
    opponent: side(opp),
    winPct,
  }
}

function buildPlayoffRace(settings: unknown, standings: RedraftStandingInput[] | null, preSeason: boolean): RedraftPlayoffRace | null {
  if (preSeason || !standings || standings.length < 2) return null
  const spots = playoffSpots(settings)
  if (spots == null || spots < 1 || spots >= standings.length) return null
  if (!standings.some(s => s.wins + s.losses + s.ties > 0)) return null
  const ordered = [...standings].sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER))
  return {
    spots,
    rows: ordered.map((s, i) => ({ rank: s.rank ?? i + 1, teamName: s.teamName, record: recordOf(s), isYou: s.isYou, inLine: i < spots })),
  }
}

function decided(game: ScoreboardGame): game is ScoreboardGame & { teams: [ScoreboardTeam, ScoreboardTeam] } {
  return game.teams.length === 2 && !game.unplayed && game.teams.every(t => typeof t.points === 'number' && Number.isFinite(t.points))
}

function buildRecap(board: LeagueScoreboard | null, currentWeek: number | null): RedraftRecap | null {
  if (!board || currentWeek == null || board.week >= currentWeek || board.allUnplayed) return null
  const games = board.games.filter(g => g.teams.length === 2)
  if (games.length === 0 || !games.every(decided)) return null
  const done = games as Array<ScoreboardGame & { teams: [ScoreboardTeam, ScoreboardTeam] }>
  let top: { team: string; points: number } | null = null
  const results: Array<{ winner: string; loser: string; margin: number }> = []
  for (const g of done) {
    const [a, b] = g.teams
    for (const t of g.teams) if (top == null || (t.points as number) > top.points) top = { team: nameOf(t), points: t.points as number }
    const margin = Math.round(Math.abs((a.points as number) - (b.points as number)) * 100) / 100
    if (margin > 0) {
      const [w, l] = (a.points as number) > (b.points as number) ? [a, b] : [b, a]
      results.push({ winner: nameOf(w), loser: nameOf(l), margin })
    }
  }
  if (!top) return null
  const byMargin = [...results].sort((x, y) => x.margin - y.margin)
  return {
    week: board.week,
    topScore: top,
    closest: byMargin[0] ?? null,
    // Only a second game can be "biggest" — with one decided game it would just repeat "closest".
    biggestWin: byMargin.length > 1 ? byMargin[byMargin.length - 1] : null,
  }
}

export function buildRedraftHomeDeck(input: BuildRedraftHomeDeckInput): RedraftHomeDeck {
  const { identity, settings, currentWeek, stage, preSeason, standings } = input
  const stageKey = (stage ?? '').toLowerCase()
  const drafting = stageKey === 'drafting' || stageKey === 'draft'
  const regular = regularSeasonWeeks(settings)
  const week = !preSeason && currentWeek != null && currentWeek > 0 ? currentWeek : null
  return {
    ...identity,
    track: {
      currentWeek: week,
      totalWeeks: null,
      // `playoffStartWeek` falls back to regular-season length + 1, which IS stored league data.
      playoffStartWeek: playoffStartWeek(settings),
      tradeDeadlineWeek: tradeDeadlineWeek(settings),
      draftComplete: !preSeason,
      drafting,
    },
    phaseLabel: phaseLabel(stage),
    regularSeason: week != null && regular != null && regular > 0 && week <= regular ? { week, of: regular } : null,
    scoreBug: preSeason ? null : buildScoreBug(input.board, currentWeek, standings),
    playoffRace: buildPlayoffRace(settings, standings, preSeason),
    recap: preSeason ? null : buildRecap(input.lastWeekBoard, currentWeek),
  }
}
