/**
 * The two lines under a starter on the Matchup board once his game is over (2026-11-09):
 *
 *   W 19–11 @ PHI                         ← his club's final, from the SportsGame row
 *   12/19 CMP, 127 YD, 4 CAR, 22 YD       ← his box score, from the stored Sleeper week stats
 *
 * Both are FINAL-ONLY by design. A live SportsGame score can trail the game by up to an hour (the
 * board's own game-state read refuses a row older than that), and NFL week stats are imported once a
 * day after the games (`/api/cron/import-player-game-stats`). A line built from either mid-game would
 * be a stale number presented as current, so a starter still playing keeps the LIVE chip instead.
 *
 * Nothing here is guessed. A missing score, a missing stat key or a zero volume leaves that part out;
 * when nothing is left the line is null and the board draws nothing.
 */

export type GameOutcome = 'W' | 'L' | 'T'

export type GameResult = {
  outcome: GameOutcome
  /** His club's points and the opponent's, in that order. */
  clubScore: number
  opponentScore: number
}

/**
 * His club's result in one final game, or null when the club is not in it or a score is missing.
 * `club` must already be normalised the way the game's teams are (normalizeTeamAbbrev).
 */
export function gameResultFor(
  club: string | null | undefined,
  game: { home: string | null; away: string | null; homeScore: number | null; awayScore: number | null },
): GameResult | null {
  if (!club) return null
  const { homeScore, awayScore } = game
  if (typeof homeScore !== 'number' || typeof awayScore !== 'number') return null
  if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) return null
  let clubScore: number
  let opponentScore: number
  if (club === game.home) {
    clubScore = homeScore
    opponentScore = awayScore
  } else if (club === game.away) {
    clubScore = awayScore
    opponentScore = homeScore
  } else {
    return null
  }
  const outcome: GameOutcome = clubScore > opponentScore ? 'W' : clubScore < opponentScore ? 'L' : 'T'
  return { outcome, clubScore, opponentScore }
}

/** A whole, non-negative count from a stat payload, or null when the key is absent or not a number. */
function count(stats: Record<string, unknown>, key: string): number | null {
  const raw = stats[key]
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN
  return Number.isFinite(n) ? n : null
}

/** Yards can be negative ("-3 YD" on a sack-heavy scramble line is real), so they are not floored. */
function int(n: number): string {
  return String(Math.round(n))
}

/**
 * An NFL box-score line from one week's Sleeper stat payload (`player_game_stats.stat_payload`,
 * source `sleeper` — the same raw keys lib/chimmy/tools/realStatsTools.ts reads), in the order a
 * broadcast reads it: passing, rushing, receiving, then kicking.
 *
 * A group appears only when its volume stat is above zero — a receiver's "0/0 CMP" or a quarterback's
 * "0 REC" is noise, not information. Touchdowns, interceptions and lost fumbles appear only when they
 * happened. Null when no group qualifies (a defense, an inactive player, an empty payload).
 */
export function nflStatLine(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const s = payload as Record<string, unknown>
  const parts: string[] = []

  const passAtt = count(s, 'pass_att')
  if (passAtt != null && passAtt > 0) {
    const cmp = count(s, 'pass_cmp')
    parts.push(`${cmp != null ? int(cmp) : '?'}/${int(passAtt)} CMP`)
    const yd = count(s, 'pass_yd')
    if (yd != null) parts.push(`${int(yd)} YD`)
    const td = count(s, 'pass_td')
    if (td != null && td > 0) parts.push(`${int(td)} TD`)
    const picks = count(s, 'pass_int')
    if (picks != null && picks > 0) parts.push(`${int(picks)} INT`)
  }

  const rushAtt = count(s, 'rush_att')
  if (rushAtt != null && rushAtt > 0) {
    parts.push(`${int(rushAtt)} CAR`)
    const yd = count(s, 'rush_yd')
    if (yd != null) parts.push(`${int(yd)} YD`)
    const td = count(s, 'rush_td')
    if (td != null && td > 0) parts.push(`${int(td)} TD`)
  }

  const rec = count(s, 'rec')
  if (rec != null && rec > 0) {
    parts.push(`${int(rec)} REC`)
    const yd = count(s, 'rec_yd')
    if (yd != null) parts.push(`${int(yd)} YD`)
    const td = count(s, 'rec_td')
    if (td != null && td > 0) parts.push(`${int(td)} TD`)
  }

  const fga = count(s, 'fga')
  if (fga != null && fga > 0) {
    const fgm = count(s, 'fgm')
    parts.push(`${fgm != null ? int(fgm) : '?'}/${int(fga)} FG`)
  }
  const xpm = count(s, 'xpm')
  if (xpm != null && xpm > 0) parts.push(`${int(xpm)} XP`)

  /* Only beside a line that already says what he did — a lone "1 FUM LOST" reads as his whole game. */
  const fumLost = count(s, 'fum_lost')
  if (parts.length > 0 && fumLost != null && fumLost > 0) parts.push(`${int(fumLost)} FUM LOST`)

  return parts.length ? parts.join(', ') : null
}
