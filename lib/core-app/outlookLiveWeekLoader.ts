import 'server-only'

import { prisma } from '@/lib/prisma'
import { starterGameStates, type StarterGameState } from './matchupGameState'
import { composePlayerIdentities } from './playerIdentityCompose'
import { remainingShare, type StarterRead } from './outlookLiveShare'

export type LineupShareTarget = { platformLeagueId: string; season: number; week: number }

export const lineupShareKey = (t: LineupShareTarget) => `${t.platformLeagueId}|${t.season}|${t.week}`

/** One lineup under way: its share still to play, and the points its starters already carry. */
export type LineupBoard = { share: number; points: number }

/**
 * For each NFL league-week under way: each roster's share of its week still to play, by platform
 * roster id. Read the same way `loadEliminationSettle` reads a guillotine week — the week's
 * `LeaguePlayerWeeklyScore` starters, their clubs, and the week's `SportsGame` rows through
 * `starterGameStates` — so the matchup screen, the cut line and the odds agree on who has played.
 *
 * Batched across leagues: one read per table for the whole board. Any failure returns an empty map,
 * and every game it covers is then simulated as unplayed — the old model, never a guessed board.
 *
 * Each readable lineup also carries the points its starters already have.
 *
 * ⚠ THE STARTER SUM IS THE LIVE BOARD; `WeeklyMatchup.pointsFor` LAGS IT. During games the live tick
 * rewrites these per-player rows (lib/live/liveSleeperPointsSync.ts) — the same rows `/core/live`
 * shows — while the matchup total moves only when the league's matchup sync next runs. Production
 * 2026-10-11, HailShiva week 5: the opponent's starters summed to 44.06 while his matchup row still
 * read 39.96. Only a lineup that read (a share) carries points, so an unreadable one never gets a
 * partial sum.
 */
export async function loadLineupBoards(targets: readonly LineupShareTarget[], now = new Date()): Promise<Map<string, Map<string, LineupBoard>>> {
  const out = new Map<string, Map<string, LineupBoard>>()
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
          // NFL league-weeks only (the fixtures above are NFL), so NFL players only.
          where: { sport: 'NFL', sleeperId: { in: ids } },
          select: { sleeperId: true, name: true, position: true, team: true, sport: true, imageUrl: true, source: true, fetchedAt: true },
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
      const boards = new Map<string, LineupBoard>()
      for (const [rosterId, starters] of rosters) {
        const share = remainingShare(starters)
        if (share != null) boards.set(rosterId, { share, points: Math.round(starters.reduce((t, s) => t + s.points, 0) * 100) / 100 })
      }
      out.set(key, boards)
    }
    return out
  } catch {
    return new Map()
  }
}
