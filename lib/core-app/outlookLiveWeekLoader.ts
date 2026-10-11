import 'server-only'

import { prisma } from '@/lib/prisma'
import { starterGameStates, type StarterGameState } from './matchupGameState'
import { composePlayerIdentities } from './playerIdentityCompose'
import { remainingShare, type StarterRead } from './outlookLiveShare'

export type LineupShareTarget = { platformLeagueId: string; season: number; week: number }

export const lineupShareKey = (t: LineupShareTarget) => `${t.platformLeagueId}|${t.season}|${t.week}`

/**
 * For each NFL league-week under way: each roster's share of its week still to play, by platform
 * roster id. Read the same way `loadEliminationSettle` reads a guillotine week — the week's
 * `LeaguePlayerWeeklyScore` starters, their clubs, and the week's `SportsGame` rows through
 * `starterGameStates` — so the matchup screen, the cut line and the odds agree on who has played.
 *
 * Batched across leagues: one read per table for the whole board. Any failure returns an empty map,
 * and every game it covers is then simulated as unplayed — the old model, never a guessed board.
 */
export async function loadLineupShares(targets: readonly LineupShareTarget[], now = new Date()): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>()
  if (targets.length === 0) return out
  try {
    const weeks = [...new Map(targets.map((t) => [`${t.season}|${t.week}`, { season: t.season, week: t.week }])).values()]
    const [starterRows, games] = await Promise.all([
      prisma.leaguePlayerWeeklyScore.findMany({
        where: { isStarter: true, OR: targets.map((t) => ({ leagueId: t.platformLeagueId, seasonYear: t.season, week: t.week })) },
        select: { leagueId: true, seasonYear: true, week: true, playerId: true, rosterId: true, points: true },
      }),
      prisma.sportsGame.findMany({
        where: { sport: 'NFL', OR: weeks.map((w) => ({ season: w.season, week: w.week })), AND: [{ OR: [{ seasonType: 'regular' }, { seasonType: null }] }] },
        select: { season: true, week: true, homeTeam: true, awayTeam: true, status: true, startTime: true, fetchedAt: true, seasonType: true },
        take: 2000,
      }),
    ])
    const ids = [...new Set(starterRows.map((r) => r.playerId))]
    const identityRows = ids.length
      ? await prisma.sportsPlayer.findMany({
          where: { sleeperId: { in: ids } },
          select: { sleeperId: true, name: true, position: true, team: true, sport: true, imageUrl: true },
        })
      : []
    const identities = composePlayerIdentities(identityRows)

    const statesByWeek = new Map<string, Map<string, StarterGameState>>()
    for (const w of weeks) {
      const weekGames = games.filter((g) => g.season === w.season && g.week === w.week)
      statesByWeek.set(`${w.season}|${w.week}`, starterGameStates(identities, weekGames, now))
    }

    const byRoster = new Map<string, Map<string, StarterRead[]>>()
    for (const r of starterRows) {
      if (r.rosterId == null) continue
      const key = lineupShareKey({ platformLeagueId: r.leagueId, season: r.seasonYear, week: r.week })
      const rosters = byRoster.get(key) ?? new Map<string, StarterRead[]>()
      const list = rosters.get(String(r.rosterId)) ?? []
      list.push({ state: statesByWeek.get(`${r.seasonYear}|${r.week}`)?.get(r.playerId) ?? 'unknown', points: Number(r.points) || 0 })
      rosters.set(String(r.rosterId), list)
      byRoster.set(key, rosters)
    }
    for (const [key, rosters] of byRoster) {
      const shares = new Map<string, number>()
      for (const [rosterId, starters] of rosters) {
        const s = remainingShare(starters)
        if (s != null) shares.set(rosterId, s)
      }
      out.set(key, shares)
    }
    return out
  } catch {
    return new Map()
  }
}
