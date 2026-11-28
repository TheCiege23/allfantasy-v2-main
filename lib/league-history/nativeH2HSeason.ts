/**
 * A native AllFantasy season as `H2HSeasonData`, the input `aggregateH2HSeasons` reads
 * (lib/league-history/sleeperH2HService.ts).
 *
 * That aggregator computes the weekly awards (top score, low score, narrow escape, biggest blowout) for the Sleeper
 * recap and the Legacy tab, and `importedFactsH2HService` already feeds it imported leagues. This feeds it a league
 * that plays here, so the native weekly recap (lib/league-chat/nativeWeeklyRecap.ts) prints the SAME awards from the
 * SAME math instead of its own copy. Every sport: the aggregator only compares scores.
 *
 * Pure. Team ids are the season's `RedraftRoster` ids, used as the aggregator's owner ids; they only need to be stable.
 * Only finished head-to-head games count — a bye, the league-median game and an unfinished game are not games here.
 */
import type { H2HSeasonData } from '@/lib/league-history/sleeperH2HService'

export type NativeH2HGame = {
  week: number
  homeRosterId: string
  awayRosterId: string | null
  homeScore: number | null
  awayScore: number | null
  status: string | null
  isMedianMatchup?: boolean | null
}

export type NativeH2HTeam = { id: string; teamName: string | null; ownerName: string | null }

const FINAL = new Set(['final', 'completed', 'complete'])

export function nativeH2HSeasonData(input: {
  season: number | string
  /** The season's head-to-head rows, any status; only finished games through `throughWeek` are used. */
  games: readonly NativeH2HGame[]
  teams: readonly NativeH2HTeam[]
  /** The week being recapped: later weeks are left out, so the awards are that week's. */
  throughWeek: number
  /**
   * An odd-team league's extra matchup (lib/redraft/oddTeamExtraMatchupRules.ts): the leftover team's score that week,
   * stored on its bye row. It is that team's week score, so it counts for top and low score; it is not a head-to-head
   * game here, because its opponent's score is already that opponent's own game.
   */
  extraScores?: ReadonlyArray<{ week: number; rosterId: string; points: number }>
}): H2HSeasonData {
  const season = String(input.season)
  const teamIds = new Set(input.teams.map((t) => t.id))
  const played = input.games.filter(
    (g) =>
      g.week <= input.throughWeek &&
      !g.isMedianMatchup &&
      g.awayRosterId != null &&
      g.homeRosterId !== g.awayRosterId &&
      teamIds.has(g.homeRosterId) &&
      teamIds.has(g.awayRosterId) &&
      FINAL.has(String(g.status ?? '').toLowerCase()) &&
      Number.isFinite(g.homeScore) &&
      Number.isFinite(g.awayScore),
  )

  const games = played.map((g) => ({
    season,
    week: g.week,
    aOwnerId: g.homeRosterId,
    bOwnerId: g.awayRosterId!,
    aPoints: Number(g.homeScore),
    bPoints: Number(g.awayScore),
  }))

  // Each team's score per week, and whether it was in the top half of that week's scores.
  const byWeek = new Map<number, Array<{ id: string; points: number }>>()
  for (const g of games) {
    const list = byWeek.get(g.week) ?? []
    list.push({ id: g.aOwnerId, points: g.aPoints }, { id: g.bOwnerId, points: g.bPoints })
    byWeek.set(g.week, list)
  }
  for (const x of input.extraScores ?? []) {
    if (x.week > input.throughWeek || !teamIds.has(x.rosterId) || !Number.isFinite(x.points)) continue
    const list = byWeek.get(x.week) ?? []
    if (list.some((e) => e.id === x.rosterId)) continue // one score per team per week
    list.push({ id: x.rosterId, points: x.points })
    byWeek.set(x.week, list)
  }
  const weekly: H2HSeasonData['weekly'] = {}
  for (const [week, entries] of byWeek) {
    const sorted = [...entries].sort((a, b) => b.points - a.points)
    const half = Math.floor(sorted.length / 2)
    sorted.forEach((entry, index) => {
      ;(weekly[entry.id] ??= []).push({ week, points: entry.points, topHalf: index < half })
    })
  }

  const managers: H2HSeasonData['managers'] = {}
  for (const t of input.teams) {
    const name = t.teamName?.trim() || t.ownerName?.trim() || 'Open team'
    managers[t.id] = { name, avatar: null, teamName: t.teamName?.trim() || null }
  }
  return { season, games, weekly, managers }
}
