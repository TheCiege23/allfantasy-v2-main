/**
 * What My team shows beside an NFL player for the week: his projection, who his club plays and when,
 * how that defense has fared against his position, his headshot and his club's crest.
 *
 * 🛑 A LEAGUE THAT PLAYS HERE SHOWED NONE OF IT. The roster holds bare ids ("11560"); the stored
 * player rows the roster read joins on are keyed "NFL:11560", so every rostered player missed and
 * came back as a name and a club code. Measured on production 2026-11-19 on a league whose draft had
 * just finished: 15 of 15 players with no projection, no opponent and no picture, while week 11
 * projections (`fantasy_projections`), the week 11 schedule (`SportsGame`) and every per-game line
 * (`player_game_stats`) were all stored.
 *
 * This is the pure half: ranking defenses, and laying the outlook over the roster's wire rows.
 */

export type OpponentRank = {
  /** 1 = allows the FEWEST fantasy points to the position (the hardest matchup). */
  rank: number
  of: number
  position: string
  /** Average fantasy points this defense has allowed to the position per game. */
  allowedPerGame: number
  games: number
}

export type NflPlayerOutlook = {
  projectedPoints: number | null
  /** Folded club code, `'BYE'` when the club has no game in a week that has games, or null when unknown. */
  opponent: string | null
  homeAway: 'home' | 'away' | null
  kickoffTimeIso: string | null
  opponentRank: OpponentRank | null
  headshotUrl: string | null
  teamLogoUrl: string | null
  opponentLogoUrl: string | null
}

/** One defense's total allowed to one position in one game. */
export type AllowedRow = { defense: string; position: string; week: number; points: number }

const RANKED_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'K'])
/** Fewer games than this and a defense's average is noise; it is left unranked rather than guessed. */
const MIN_GAMES = 3

/**
 * Every defense's rank against every position, from what each allowed per game.
 *
 * Rank 1 allows the fewest. `of` is how many defenses were ranked for that position, so "28th of 32"
 * is never printed against a denominator that is not there.
 */
export function rankDefensesVsPosition(rows: readonly AllowedRow[]): Map<string, OpponentRank> {
  const byKey = new Map<string, { defense: string; position: string; total: number; weeks: Set<number> }>()
  for (const r of rows) {
    const position = String(r.position ?? '').toUpperCase()
    const defense = String(r.defense ?? '').toUpperCase()
    if (!RANKED_POSITIONS.has(position) || !defense || !Number.isFinite(r.points)) continue
    const key = `${defense}|${position}`
    const hit = byKey.get(key) ?? { defense, position, total: 0, weeks: new Set<number>() }
    hit.total += r.points
    hit.weeks.add(r.week)
    byKey.set(key, hit)
  }
  const byPosition = new Map<string, Array<{ defense: string; avg: number; games: number }>>()
  for (const v of byKey.values()) {
    if (v.weeks.size < MIN_GAMES) continue
    const list = byPosition.get(v.position) ?? []
    list.push({ defense: v.defense, avg: v.total / v.weeks.size, games: v.weeks.size })
    byPosition.set(v.position, list)
  }
  const out = new Map<string, OpponentRank>()
  for (const [position, list] of byPosition) {
    list.sort((a, b) => a.avg - b.avg || a.defense.localeCompare(b.defense))
    list.forEach((d, i) => {
      out.set(`${d.defense}|${position}`, {
        rank: i + 1,
        of: list.length,
        position,
        allowedPerGame: Math.round(d.avg * 10) / 10,
        games: d.games,
      })
    })
  }
  return out
}

/** How hard the matchup is, in thirds of the ranked field: a low rank is a stingy defense. */
export function matchupTone(rank: Pick<OpponentRank, 'rank' | 'of'> | null | undefined): 'hard' | 'even' | 'easy' | null {
  if (!rank || rank.of < 3) return null
  const third = rank.of / 3
  if (rank.rank <= third) return 'hard'
  if (rank.rank > rank.of - third) return 'easy'
  return 'even'
}

export type NflOutlookWireFields = {
  projectedPoints?: number | null
  projectionsSource?: string | null
  headshotUrl?: string | null
  imageUrl?: string | null
  teamLogoUrl?: string | null
  periodOpponent?: string | null
  periodHomeAway?: 'home' | 'away' | null
  periodKickoffIso?: string | null
  opponentRank?: OpponentRank | null
  opponentLogoUrl?: string | null
}

export const AF_WEEK_PROJECTION_SOURCE = 'allfantasy'

/**
 * Lay the outlook over the roster rows. A value the row already carries is kept: the outlook fills
 * what is missing, it never replaces a projection or a picture another layer supplied.
 */
export function applyNflRosterOutlook<T extends { id: string } & NflOutlookWireFields>(
  rows: readonly T[],
  outlook: ReadonlyMap<string, NflPlayerOutlook>,
): T[] {
  return rows.map((row) => {
    const o = outlook.get(row.id)
    if (!o) return row
    const fillProjection = row.projectedPoints == null && o.projectedPoints != null
    return {
      ...row,
      ...(fillProjection ? { projectedPoints: o.projectedPoints, projectionsSource: AF_WEEK_PROJECTION_SOURCE } : {}),
      headshotUrl: row.headshotUrl ?? o.headshotUrl,
      imageUrl: row.imageUrl ?? row.headshotUrl ?? o.headshotUrl,
      teamLogoUrl: row.teamLogoUrl ?? o.teamLogoUrl,
      ...(row.periodOpponent == null && o.opponent != null ? { periodOpponent: o.opponent, periodHomeAway: o.homeAway } : {}),
      periodKickoffIso: row.periodKickoffIso ?? o.kickoffTimeIso,
      opponentRank: o.opponentRank,
      opponentLogoUrl: o.opponentLogoUrl,
    }
  })
}
