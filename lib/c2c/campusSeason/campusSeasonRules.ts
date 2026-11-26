/**
 * The college side of an NFL C2C league in the "separate" standings model (owner's decision, 2026-11-24):
 * its own schedule on college football weeks, its own win-loss record and standings (with the league
 * median, when the league plays one), its own playoff and champion, and an overall title for the best
 * combined finish across both sides.
 *
 * Pure: no database. The runner (./runCampusSeason.ts) reads and writes; this file decides.
 */
import { medianGameRecords } from '@/lib/core-app/medianGame'
import { firstRoundByesForTeams, playoffRoundsForTeams } from '@/lib/playoff-runtime/playoffFit'

/** League.settings keys (no schema change: an existing league's config read is untouched). */
export const CAMPUS_REGULAR_WEEKS_KEY = 'c2c_college_regular_weeks'
export const CAMPUS_PLAYOFF_TEAMS_KEY = 'c2c_college_playoff_teams'

/** Cream Bowl's shape: ten regular weeks, then a six-team playoff over weeks 11 to 13. */
export const DEFAULT_CAMPUS_REGULAR_WEEKS = 10
export const DEFAULT_CAMPUS_PLAYOFF_TEAMS = 6
/** CFBD's regular season runs to about week 14 with conference championships; leave room for a bracket. */
const MAX_CAMPUS_WEEKS = 15

const int = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : null
}

export type CampusSeasonShape = { regularSeasonWeeks: number; playoffTeams: number; playoffRounds: number; lastWeek: number }

/** The college season's shape for a league of `teamCount` teams, from its settings. */
export function readCampusSeasonShape(settings: unknown, teamCount: number): CampusSeasonShape {
  const s = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {}
  let playoffTeams = int(s[CAMPUS_PLAYOFF_TEAMS_KEY]) ?? DEFAULT_CAMPUS_PLAYOFF_TEAMS
  playoffTeams = Math.max(0, Math.min(playoffTeams, teamCount, 32))
  if (playoffTeams === 1) playoffTeams = 0
  const playoffRounds = playoffRoundsForTeams(playoffTeams)
  let regularSeasonWeeks = int(s[CAMPUS_REGULAR_WEEKS_KEY]) ?? DEFAULT_CAMPUS_REGULAR_WEEKS
  regularSeasonWeeks = Math.max(1, Math.min(regularSeasonWeeks, MAX_CAMPUS_WEEKS - playoffRounds))
  return { regularSeasonWeeks, playoffTeams, playoffRounds, lastWeek: regularSeasonWeeks + playoffRounds }
}

export type CampusGame = {
  week: number
  homeRosterId: string
  awayRosterId: string | null
  homeScore: number
  awayScore: number
  status: string
  kind: string
}

export type CampusStandingRow = {
  rosterId: string
  wins: number
  losses: number
  ties: number
  medianWins: number
  medianLosses: number
  medianTies: number
  pointsFor: number
  pointsAgainst: number
  rank: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Standings from the FINAL regular-season college games. A team plays several games in a week when the
 * league does (games per week), so points for count once per week, as on the pro side; points against
 * add every opponent faced. The median game is one more result a week, decided over the week's scores.
 * Ordered by wins (a tie as half), then points for, then a stable id.
 */
export function computeCampusStandings(input: { rosterIds: readonly string[]; games: readonly CampusGame[]; medianGame: boolean }): CampusStandingRow[] {
  const rows = new Map<string, CampusStandingRow>()
  for (const id of input.rosterIds) {
    rows.set(id, { rosterId: id, wins: 0, losses: 0, ties: 0, medianWins: 0, medianLosses: 0, medianTies: 0, pointsFor: 0, pointsAgainst: 0, rank: 0 })
  }
  const weekScore = new Map<string, number>() // `${week}|${roster}` -> that week's score
  for (const g of input.games) {
    if (g.status !== 'final' || g.kind === 'playoff') continue
    const home = rows.get(g.homeRosterId)
    if (!home) continue
    weekScore.set(`${g.week}|${g.homeRosterId}`, g.homeScore)
    if (!g.awayRosterId) continue // a bye: the week's score counts toward points for and the median only
    const away = rows.get(g.awayRosterId)
    if (!away) continue
    weekScore.set(`${g.week}|${g.awayRosterId}`, g.awayScore)
    home.pointsAgainst += g.awayScore
    away.pointsAgainst += g.homeScore
    if (g.homeScore > g.awayScore) { home.wins++; away.losses++ }
    else if (g.homeScore < g.awayScore) { home.losses++; away.wins++ }
    else { home.ties++; away.ties++ }
  }
  const scored: Array<{ week: number; rosterId: string; pointsFor: number }> = []
  for (const [key, pts] of weekScore) {
    const [week, rosterId] = key.split('|')
    const row = rows.get(rosterId!)
    if (!row) continue
    row.pointsFor += pts
    scored.push({ week: Number(week), rosterId: rosterId!, pointsFor: pts })
  }
  if (input.medianGame) {
    for (const [id, rec] of medianGameRecords(scored)) {
      const row = rows.get(id)
      if (!row) continue
      row.medianWins = rec.wins
      row.medianLosses = rec.losses
      row.medianTies = rec.ties
    }
  }
  const ordered = [...rows.values()].map((r) => ({ ...r, pointsFor: round2(r.pointsFor), pointsAgainst: round2(r.pointsAgainst) }))
  const winScore = (r: CampusStandingRow) => r.wins + r.medianWins + (r.ties + r.medianTies) / 2
  ordered.sort((a, b) => winScore(b) - winScore(a) || b.pointsFor - a.pointsFor || a.rosterId.localeCompare(b.rosterId))
  ordered.forEach((r, i) => { r.rank = i + 1 })
  return ordered
}

export type BracketGame = { homeRosterId: string; awayRosterId: string | null; bracketSlot: number }

/**
 * One round of the college playoff, re-seeded each round: the best remaining seed plays the worst.
 * Round 1 gives the top seeds a bye up to the next power of two (6 teams: seeds 1 and 2 rest).
 * `alive` holds the seeds still in it, best first. A bye is a game with no away team.
 */
export function campusBracketRound(input: { round: number; seeded: readonly string[]; alive: readonly string[] }): BracketGame[] {
  const seedOf = new Map(input.seeded.map((id, i) => [id, i + 1]))
  const alive = [...input.alive].sort((a, b) => (seedOf.get(a) ?? 999) - (seedOf.get(b) ?? 999))
  const games: BracketGame[] = []
  let playing = alive
  if (input.round === 1) {
    const byes = firstRoundByesForTeams(alive.length)
    alive.slice(0, byes).forEach((id, i) => games.push({ homeRosterId: id, awayRosterId: null, bracketSlot: i + 1 }))
    playing = alive.slice(byes)
  }
  for (let i = 0; i < Math.floor(playing.length / 2); i++) {
    games.push({ homeRosterId: playing[i]!, awayRosterId: playing[playing.length - 1 - i]!, bracketSlot: games.length + 1 })
  }
  return games
}

/** The team that advances from a final playoff game: higher score, a tie to the better seed. */
export function campusPlayoffWinner(game: CampusGame, seeded: readonly string[]): string {
  if (!game.awayRosterId) return game.homeRosterId
  if (game.homeScore !== game.awayScore) return game.homeScore > game.awayScore ? game.homeRosterId : game.awayRosterId
  const seed = (id: string) => { const i = seeded.indexOf(id); return i < 0 ? 999 : i }
  return seed(game.homeRosterId) <= seed(game.awayRosterId) ? game.homeRosterId : game.awayRosterId
}

export type OverallTitleRow = { rosterId: string; wins: number; losses: number; ties: number; pointsFor: number; rank: number }

/**
 * The overall title: the best combined finish across both sides — every win, loss and tie from the pro
 * and college records (median results included), then combined points for.
 */
export function overallTitleStandings(input: {
  pro: ReadonlyArray<{ rosterId: string; wins: number; losses: number; ties: number; pointsFor: number }>
  college: ReadonlyArray<CampusStandingRow>
}): OverallTitleRow[] {
  const out = new Map<string, OverallTitleRow>()
  for (const p of input.pro) out.set(p.rosterId, { rosterId: p.rosterId, wins: p.wins, losses: p.losses, ties: p.ties, pointsFor: p.pointsFor, rank: 0 })
  for (const c of input.college) {
    const r = out.get(c.rosterId) ?? { rosterId: c.rosterId, wins: 0, losses: 0, ties: 0, pointsFor: 0, rank: 0 }
    r.wins += c.wins + c.medianWins
    r.losses += c.losses + c.medianLosses
    r.ties += c.ties + c.medianTies
    r.pointsFor = round2(r.pointsFor + c.pointsFor)
    out.set(c.rosterId, r)
  }
  const rows = [...out.values()]
  rows.sort((a, b) => b.wins + b.ties / 2 - (a.wins + a.ties / 2) || b.pointsFor - a.pointsFor || a.rosterId.localeCompare(b.rosterId))
  rows.forEach((r, i) => { r.rank = i + 1 })
  return rows
}
