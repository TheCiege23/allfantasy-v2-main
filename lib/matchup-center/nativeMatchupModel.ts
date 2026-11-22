/**
 * The Matchup tab of a league that plays on AllFantasy, read from its own season.
 *
 * 🛑 THE TAB READ A TABLE THE SEASON NEVER WRITES. `/api/leagues/[id]/matchup-center` and
 * `/api/leagues/[id]/scoring/matchups` read `teamWeekResult` and `weeklyScore`. For a native league
 * those are written only by `server/services/weeklyProcessor.ts`, which nothing runs on a schedule
 * and which pairs teams with a round-robin it invents. The season itself lives in `RedraftMatchup`
 * (the schedule and the scores the score sync keeps current) and `RedraftPlayoffMatchup` (the
 * bracket). So a league in week 2 with a scored, final week 1 showed "No opponent", 0.0 and an empty
 * scoreboard.
 *
 * This file is the pure half: which season, which week, which team is the viewer's, and which games
 * a week holds. `server/services/nativeMatchupCenter.ts` does the reads.
 */

export type NativeGameStatus = 'upcoming' | 'live' | 'final'

/** A stored matchup status in the three states the screen draws. `active` is the score sync's "live". */
export function nativeGameStatus(status: string | null | undefined): NativeGameStatus {
  const s = String(status ?? '').trim().toLowerCase()
  if (s === 'final' || s === 'complete' || s === 'completed') return 'final'
  if (s === 'active' || s === 'live' || s === 'in_progress') return 'live'
  return 'upcoming'
}

/**
 * A regular-season game's state for the screen.
 *
 * ⚠ THE SCORE SYNC MARKS A GAME `active` THE FIRST TIME IT TOUCHES IT, not when a player takes the
 * field: a lineup save or a routine re-score is enough. So early in a week one game read LIVE at
 * 0.0 - 0.0 beside five that read as not started (seen on the real page, 2026-11-19). In a points
 * league a game with no points on either side has not started as far as anyone watching can tell.
 * A category league is left alone: 0 - 0 there can be a week of tied categories.
 */
export function regularGameStatus(args: { status: string | null | undefined; homeScore: number; awayScore: number; pointsLeague: boolean }): NativeGameStatus {
  const status = nativeGameStatus(args.status)
  if (status === 'live' && args.pointsLeague && args.homeScore === 0 && args.awayScore === 0) return 'upcoming'
  return status
}

type SeasonLike = { season: number; currentWeek: number }

/**
 * The season the tab shows: the year asked for when the league has it, otherwise the newest season
 * that has started, otherwise the newest. A league rolled into next year keeps showing the season it
 * played until the new one has a week.
 */
export function pickNativeSeason<T extends SeasonLike>(seasons: readonly T[], askedYear?: number | null): T | null {
  if (seasons.length === 0) return null
  if (askedYear != null && Number.isFinite(askedYear)) {
    const exact = seasons.find((s) => s.season === askedYear)
    if (exact) return exact
  }
  const newestFirst = [...seasons].sort((a, b) => b.season - a.season)
  return newestFirst.find((s) => s.currentWeek >= 1) ?? newestFirst[0]
}

/** The week to open on: the one asked for, else the season's own week. Never below 1. */
export function nativeMatchupWeek(asked: number | null | undefined, currentWeek: number | null | undefined): number {
  if (asked != null && Number.isInteger(asked) && asked >= 1) return asked
  const current = Number(currentWeek)
  return Number.isInteger(current) && current >= 1 ? current : 1
}

type RosterLike = { id: string; ownerId: string; managerUserId?: string | null }

/**
 * The viewer's team. Their own team first; a manager's second and later teams carry a key of their
 * own in `ownerId` and name the manager in `managerUserId`, so those come next, in a stable order.
 */
export function pickViewerRosterId(rosters: readonly RosterLike[], userId: string): string | null {
  const own = rosters.find((r) => r.ownerId === userId)
  if (own) return own.id
  const managed = rosters.filter((r) => r.managerUserId === userId).sort((a, b) => a.id.localeCompare(b.id))
  return managed[0]?.id ?? null
}

export type NativeWeekGame = {
  id: string
  kind: 'regular' | 'playoff' | 'consolation'
  /** A playoff game's round name ("Semifinal"), when the bracket names it. */
  label: string | null
  homeRosterId: string
  /** Null on a bye. */
  awayRosterId: string | null
  homeScore: number
  awayScore: number
  status: NativeGameStatus
}

/** The games a team plays this week, in the order the schedule holds them. A bye is not a game. */
export function gamesForRoster(games: readonly NativeWeekGame[], rosterId: string): NativeWeekGame[] {
  return games.filter((g) => g.awayRosterId != null && (g.homeRosterId === rosterId || g.awayRosterId === rosterId))
}

/** True when the week's only row for this team is a bye. */
export function isByeWeek(games: readonly NativeWeekGame[], rosterId: string): boolean {
  return gamesForRoster(games, rosterId).length === 0 && games.some((g) => g.awayRosterId == null && g.homeRosterId === rosterId)
}

export type NativeBoardGame = {
  id: string
  kind: NativeWeekGame['kind']
  label: string | null
  status: NativeGameStatus
  home: { rosterId: string; teamName: string; totalPoints: number | null }
  /** Null on a bye. */
  away: { rosterId: string; teamName: string; totalPoints: number | null } | null
  /** True when the viewer plays in it. */
  mine: boolean
}

/**
 * The week's scoreboard: one line per game, the viewer's games first. A game that has not started
 * shows no score rather than 0.0, which reads as a result.
 */
export function buildNativeBoard(
  games: readonly NativeWeekGame[],
  nameOf: (rosterId: string) => string,
  viewerRosterId: string | null,
): NativeBoardGame[] {
  const out = games.map((g): NativeBoardGame => {
    const played = g.status !== 'upcoming'
    return {
      id: g.id,
      kind: g.kind,
      label: g.label,
      status: g.status,
      home: { rosterId: g.homeRosterId, teamName: nameOf(g.homeRosterId), totalPoints: played ? g.homeScore : null },
      away: g.awayRosterId
        ? { rosterId: g.awayRosterId, teamName: nameOf(g.awayRosterId), totalPoints: played ? g.awayScore : null }
        : null,
      mine: viewerRosterId != null && (g.homeRosterId === viewerRosterId || g.awayRosterId === viewerRosterId),
    }
  })
  // Stable: the viewer's games first, byes last, the schedule's order otherwise.
  return out
    .map((g, i) => ({ g, i }))
    .sort((a, b) => Number(b.g.mine) - Number(a.g.mine) || Number(a.g.away == null) - Number(b.g.away == null) || a.i - b.i)
    .map((x) => x.g)
}

/** What a native league's matchup payload carries beyond the shared shape. */
export type NativeMatchupExtras = {
  /** Category leagues: the two scores are categories won, and players carry no points. */
  scoreUnit: 'points' | 'categories'
  /** False when the week has no per-player breakdown for the viewer's game: draw dashes, not 0.0. */
  playerPointsAvailable: boolean
  /** A playoff game's round name. */
  gameLabel: string | null
  /** True when the team sits this week out. */
  bye: boolean
  /** The viewer's other games this week (a league that plays more than one game a week). */
  otherGames: NativeBoardGame[]
  /** Which game of the week the card shows, 1-based, and how many the viewer plays. */
  gameNumber: number
  gameCount: number
}

type PlayerLike = { playerId: string; playerName: string; position: string; team: string | null; slotType: string }
type ScoreRow = { playerId: string; points: number; isStarter: boolean; isFinalized?: boolean }

export type NativeStarter = { playerId: string; name: string; position: string; team: string | null; points: number | null }

const POSITION_ORDER = [
  'QB', 'RB', 'WR', 'TE', 'FLEX', 'WRT', 'SUPER_FLEX', 'SFLEX', 'OP', 'K', 'DEF', 'DST', 'DL', 'LB', 'DB', 'IDP',
  'PG', 'SG', 'G', 'SF', 'PF', 'F', 'C', 'UTIL',
  'SP', 'RP', 'P', '1B', '2B', '3B', 'SS', 'IF', 'OF', 'DH',
  'LW', 'RW', 'W', 'D', 'GK',
]
const positionRank = (position: string) => {
  const i = POSITION_ORDER.indexOf(position.toUpperCase())
  return i === -1 ? POSITION_ORDER.length : i
}

/**
 * The lineup to draw for one team's week.
 *
 * FINISHED week (every score row finalized): the players the scoring counted as starters, with the
 * points it counted — not who sits in the lineup today, which a manager may have changed since.
 *
 * LIVE or UNSCORED week: every current starter, each with the points counted so far, or a dash
 * (never 0.0) while his game has produced nothing. Plus any player the scoring already counted as a
 * starter who has since left the lineup: those points are in the team's total.
 *
 * 🛑 THE BUG THIS CLOSES (owner report, 2026-11-22, Zombie Chimmy Test week 11): the first branch ran
 * as soon as ANY starter had a score row, so mid-week the matchup listed only the starters whose games
 * had started — four of eight on one side, three on the other, a TE slot shown "Empty" — while the
 * roster page showed all eight. Every sport's hosted matchup reads this.
 */
export function buildNativeStarters(args: {
  /** The team's players, dropped ones included, so a scored player who has since left still has a name. */
  players: readonly PlayerLike[]
  /** The current starters' ids (the week's saved lineup already applied). */
  currentStarterIds: ReadonlySet<string>
  /** The week's counted points for this team, or null when it has not been scored. */
  scores: readonly ScoreRow[] | null
}): NativeStarter[] {
  const byId = new Map(args.players.map((p) => [p.playerId, p]))
  const rows: NativeStarter[] = []
  const counted = (args.scores ?? []).filter((s) => s.isStarter)
  const finished = counted.length > 0 && (args.scores ?? []).every((s) => s.isFinalized === true)
  if (finished) {
    for (const s of counted) {
      if (!s.isStarter) continue
      const p = byId.get(s.playerId)
      rows.push({
        playerId: s.playerId,
        name: p?.playerName ?? 'Player',
        position: (p?.position ?? '').toUpperCase() || 'FLEX',
        team: p?.team ?? null,
        points: s.points,
      })
    }
  } else {
    const pointsOf = new Map(counted.map((s) => [s.playerId, s.points]))
    for (const p of args.players) {
      if (!args.currentStarterIds.has(p.playerId)) continue
      if (rows.some((r) => r.playerId === p.playerId)) continue
      rows.push({
        playerId: p.playerId,
        name: p.playerName,
        position: (p.position ?? '').toUpperCase() || 'FLEX',
        team: p.team ?? null,
        points: pointsOf.get(p.playerId) ?? null,
      })
    }
    // Counted as a starter, then moved out of the lineup: his points stay in the total, so he stays here.
    for (const s of counted) {
      if (rows.some((r) => r.playerId === s.playerId)) continue
      const p = byId.get(s.playerId)
      rows.push({
        playerId: s.playerId,
        name: p?.playerName ?? 'Player',
        position: (p?.position ?? '').toUpperCase() || 'FLEX',
        team: p?.team ?? null,
        points: s.points,
      })
    }
  }
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => positionRank(a.r.position) - positionRank(b.r.position) || a.i - b.i)
    .map((x) => x.r)
}
