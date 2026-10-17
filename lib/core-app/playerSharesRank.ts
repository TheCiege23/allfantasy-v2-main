/**
 * "Your shares" — how many of your rosters hold each player, and where he starts.
 *
 * Pure and client-safe; the loader (playerShares.ts) reads the rosters and has ALREADY translated
 * every id into the Sleeper vocabulary (or dropped it) before this counts anything.
 *
 * ⚠ ONE ROSTER PER LEAGUE. A league counts once however many of your rows mirror it; the loader
 * passes one roster per league, and a player listed twice in a roster's arrays (a starter is also
 * in `players`) is one share, placed in his most important slot.
 */

export type RosterForShares = {
  leagueId: string
  starters: readonly string[]
  reserve: readonly string[]
  taxi: readonly string[]
  players: readonly string[]
}

export type ShareCount = {
  sleeperId: string
  /** Rosters of yours holding him. */
  leagues: number
  /** Of those, where he is in the starting lineup. */
  starts: number
  /** Of those, where he sits in an IR slot. */
  ir: number
  leagueIds: string[]
}

const usable = (id: string) => Boolean(id) && id !== '0'

export function countShares(rosters: readonly RosterForShares[]): ShareCount[] {
  const byId = new Map<string, ShareCount>()
  const seenLeague = new Set<string>()
  for (const r of rosters) {
    if (seenLeague.has(r.leagueId)) continue
    seenLeague.add(r.leagueId)
    const starters = new Set(r.starters.filter(usable))
    const reserve = new Set(r.reserve.filter(usable))
    const all = new Set([...r.players, ...r.starters, ...r.reserve, ...r.taxi].filter(usable))
    for (const id of all) {
      const row = byId.get(id) ?? { sleeperId: id, leagues: 0, starts: 0, ir: 0, leagueIds: [] }
      row.leagues += 1
      if (starters.has(id)) row.starts += 1
      else if (reserve.has(id)) row.ir += 1
      row.leagueIds.push(r.leagueId)
      byId.set(id, row)
    }
  }
  return [...byId.values()].sort((a, b) => b.leagues - a.leagues || b.starts - a.starts || a.sleeperId.localeCompare(b.sleeperId))
}

/** "in 9 of 49 leagues" as a fraction for the share bar; 0 when nothing was read. */
export function shareOf(leagues: number, leaguesRead: number): number {
  return leaguesRead > 0 ? Math.min(1, leagues / leaguesRead) : 0
}
