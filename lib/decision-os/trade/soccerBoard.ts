/**
 * The soccer trade-grade board: each player's per-match production this season, steadied by last
 * season, on his CLUB's match scale. PURE. The loader (`./sportPointsContext.ts`) reads the match rows;
 * `lib/af-projections/soccerSeasonLines.ts` turns each season's rows into season lines first.
 *
 * WHY NOT THE STORED PROJECTIONS. The projection writer chooses ONE season per player and moves to this
 * season at three appearances, so in October nearly every soccer projection rests on four to six matches
 * (measured 2026-10-09: median 4). A grade on that would rank a forward on two goals in four games above
 * one with 25 last season. So the grade reads both seasons and blends them itself:
 *
 *   - BLEND. A player's per-appearance rate is this season's matches plus last season counted as up to
 *     PRIOR_SEASON_APPEARANCES appearances at last season's rate. Four matches in, last season carries
 *     ten parts in fourteen; thirty matches in, ten in forty. A player with no prior season stands on his
 *     own matches and needs ten of them before the sample bar prices him.
 *   - ACTIVE ONLY. Only players who have played this season are on the board. Last season's rows include
 *     everyone who has since left these leagues; as "free agents" they would set the replacement level.
 *   - ROTATION. A soccer player does not play every match his club plays. His line is scaled to his
 *     share of his club's matches, blended the same way (this season's share, steadied by last season's),
 *     so a rotation player is not valued as an every-match starter — baseball's pitcher rule, for the
 *     same reason (`./mlbTeamGame.ts`).
 *
 * The result is per CLUB match, so the grader multiplies it by the matches left exactly as it does for
 * every other sport.
 */
import type { SoccerSeasonLine } from '@/lib/af-projections/soccerSeasonLines'

/** How many appearances' worth of last season steadies this season's line. */
export const PRIOR_SEASON_APPEARANCES = 10

/** A club's match count in a set of rows: any match one of its players has a row for. */
export function clubMatchCounts(rows: ReadonlyArray<{ team: string | null; gameId: string }>): Map<string, number> {
  const matches = new Map<string, Set<string>>()
  for (const r of rows) {
    if (!r.team) continue
    const i = r.gameId.lastIndexOf(':')
    const match = i > 0 ? r.gameId.slice(0, i) : r.gameId // one row per group: `20260920-12-2:fielders`
    const held = matches.get(r.team) ?? new Set<string>()
    held.add(match)
    matches.set(r.team, held)
  }
  return new Map([...matches].map(([team, set]) => [team, set.size]))
}

export type SoccerBoardLine = {
  playerId: string
  name: string | null
  position: string | null
  team: string | null
  /** Per CLUB match: the blended per-appearance line times the blended share of his club's matches. */
  stats: Record<string, number>
  /** This season's appearances plus last season's weight — what the sample bar reads. */
  sampleGames: number
  /** Share of his club's matches he plays. */
  share: number
  currentAppearances: number
  priorAppearances: number
}

export function blendSoccerSeasons(args: {
  current: readonly SoccerSeasonLine[]
  prior: readonly SoccerSeasonLine[]
  clubMatches: { current: ReadonlyMap<string, number>; prior: ReadonlyMap<string, number> }
}): SoccerBoardLine[] {
  const priorById = new Map(args.prior.map((l) => [l.playerId, l]))
  const out: SoccerBoardLine[] = []
  for (const cur of args.current) {
    const { games_played: c = 0, ...curTotals } = cur.stats.regular_season
    if (c <= 0) continue
    const prior = priorById.get(cur.playerId)
    const { games_played: q = 0, ...priorTotals } = prior?.stats.regular_season ?? { games_played: 0 }
    const weight = Math.min(q, PRIOR_SEASON_APPEARANCES)

    const perAppearance: Record<string, number> = {}
    for (const key of new Set([...Object.keys(curTotals), ...Object.keys(priorTotals)])) {
      const priorRate = q > 0 ? (priorTotals[key] ?? 0) / q : 0
      perAppearance[key] = ((curTotals[key] ?? 0) + weight * priorRate) / (c + weight)
    }

    // His club's matches this season; a player whose club cannot be read is taken at his own count.
    const clubMatches = (cur.stats.riTeam && args.clubMatches.current.get(cur.stats.riTeam)) || c
    const priorClubMatches = (prior?.stats.riTeam && args.clubMatches.prior.get(prior.stats.riTeam)) || q
    const priorShare = q > 0 && priorClubMatches > 0 ? Math.min(1, q / priorClubMatches) : 0
    const share = Math.min(1, (c + weight * priorShare) / (clubMatches + weight))

    const stats: Record<string, number> = {}
    for (const [key, value] of Object.entries(perAppearance)) stats[key] = value * share
    out.push({
      playerId: cur.playerId,
      name: cur.stats.riPlayerName,
      position: cur.stats.position,
      team: cur.stats.riTeam,
      stats,
      sampleGames: c + weight,
      share,
      currentAppearances: c,
      priorAppearances: q,
    })
  }
  return out
}
