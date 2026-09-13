/**
 * "My games" player list: one row per player, the leagues he starts in behind a
 * disclosure.
 *
 * User decision, 2026-09-13: the card used to print one row per (league, player)
 * INCLUDING bench players, so a single WR rostered in fifteen leagues produced
 * fifteen near-identical rows and a game card several screens tall. The list is
 * now starters only — bench, IR and taxi are not in it — grouped by player.
 *
 * Pure so the grouping can be tested without rendering.
 */

export type TieInLike = {
  leagueId: string
  leagueName: string
  playerId: string
  playerName: string
  position: string | null
  imageUrl: string | null
  isStarter: boolean
  points: number | null
}

export type StarterGroup = {
  playerId: string
  playerName: string
  position: string | null
  imageUrl: string | null
  leagues: Array<{ leagueId: string; leagueName: string; points: number | null }>
}

export function groupStartersByPlayer(tieIns: readonly TieInLike[]): StarterGroup[] {
  const byPlayer = new Map<string, StarterGroup>()
  for (const t of tieIns) {
    if (!t.isStarter) continue
    let group = byPlayer.get(t.playerId)
    if (!group) {
      group = {
        playerId: t.playerId,
        playerName: t.playerName,
        position: t.position,
        imageUrl: t.imageUrl,
        leagues: [],
      }
      byPlayer.set(t.playerId, group)
    }
    // One entry per league even if a league somehow reports the player twice.
    if (group.leagues.some((l) => l.leagueId === t.leagueId)) continue
    group.leagues.push({ leagueId: t.leagueId, leagueName: t.leagueName, points: t.points })
    if (!group.imageUrl && t.imageUrl) group.imageUrl = t.imageUrl
  }
  return [...byPlayer.values()].sort(
    (a, b) => b.leagues.length - a.leagues.length || a.playerName.localeCompare(b.playerName),
  )
}

/**
 * The summary number on a collapsed row.
 *
 * ⚠ A RANGE, NOT A SUM AND NOT ONE LEAGUE'S NUMBER. Each league scores the same
 * performance its own way, so "14.2 pts" beside a player in three leagues would
 * be true in at most one of them. Null when no league has reported — an em dash
 * in the UI, never 0.0.
 */
export function pointsSummary(group: StarterGroup): { min: number; max: number } | null {
  const values = group.leagues.map((l) => l.points).filter((p): p is number => p != null && Number.isFinite(p))
  if (values.length === 0) return null
  return { min: Math.min(...values), max: Math.max(...values) }
}
