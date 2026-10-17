import 'server-only'

import { prisma } from '@/lib/prisma'
import { resolveSleeperPlayers } from './sleeperPlayerRefs'

/**
 * "Your Week N MVP" (Guap, 2026-10-08, item #5): the player who scored the most points FOR YOU last
 * week — summed over every league where he was in your starting lineup — as a card you can share.
 *
 * ⚠ THE PLATFORM'S OWN POINTS, NEVER OURS. `league_player_weekly_scores` holds what Sleeper scored
 * (lineupEfficiency.ts says why it is Sleeper-only), with `isStarter` and the roster that held him.
 * Your roster in a league is your claimed LeagueTeam's `externalId` (Sleeper's roster_id), the same
 * join lineupEfficiency and the receipts use. A bench point is not an MVP point.
 *
 * ⚠ "LAST WEEK" IS THE SCHEDULE'S, NOT `max(week)` ON THE SCORES TABLE. The Sleeper sync seeds whole
 * seasons of rows ahead of play (currentWeek.ts records the 9,354 zero rows that taught this repo
 * that), and a live week carries partial points. The week before the next scheduled NFL regular-season
 * game is the last one finished — on a Friday it is last week, not the week whose Thursday game just
 * ended.
 *
 * Null when there is nothing honest to show: no upcoming game on file (off-season), week 1 still
 * ahead, no Sleeper league of yours, or no starter points recorded for that week.
 */

export type WeeklyMvp = {
  season: number
  week: number
  player: { sleeperId: string; name: string; position: string | null; team: string | null; imageUrl: string | null; ref: string | null }
  /** His points for you that week, every league summed. */
  points: number
  leagues: Array<{ leagueId: string; leagueName: string; points: number }>
  /** The next-best, so the card can say by how much he won. */
  runnerUp: { name: string; points: number } | null
  /** Leagues whose week was read — "across 3 of your leagues". */
  leaguesRead: number
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** Pure: the MVP from starter rows already narrowed to your rosters. Exported for tests. */
export function pickMvp(
  rows: ReadonlyArray<{ leagueId: string; playerId: string; points: number }>,
  leagueNames: ReadonlyMap<string, string>,
): { playerId: string; points: number; leagues: WeeklyMvp['leagues']; runnerUp: { playerId: string; points: number } | null } | null {
  const byPlayer = new Map<string, { points: number; best: number; leagues: WeeklyMvp['leagues'] }>()
  for (const r of rows) {
    if (!Number.isFinite(r.points)) continue
    const cur = byPlayer.get(r.playerId) ?? { points: 0, best: 0, leagues: [] }
    cur.points += r.points
    cur.best = Math.max(cur.best, r.points)
    cur.leagues.push({ leagueId: r.leagueId, leagueName: leagueNames.get(r.leagueId) ?? 'League', points: round1(r.points) })
    byPlayer.set(r.playerId, cur)
  }
  // Most points for you; a tie goes to the bigger single game, then the id, so the answer is stable.
  const ranked = [...byPlayer].sort((a, b) => b[1].points - a[1].points || b[1].best - a[1].best || a[0].localeCompare(b[0]))
  const top = ranked[0]
  if (!top || top[1].points <= 0) return null
  const second = ranked[1]
  return {
    playerId: top[0],
    points: round1(top[1].points),
    leagues: top[1].leagues.sort((a, b) => b.points - a.points),
    runnerUp: second ? { playerId: second[0], points: round1(second[1].points) } : null,
  }
}

export async function loadWeeklyMvp(userId: string, now: Date = new Date()): Promise<WeeklyMvp | null> {
  const next = await prisma.sportsGame.findFirst({
    where: { sport: 'NFL', seasonType: 'regular', startTime: { gt: now }, week: { not: null }, season: { not: null } },
    orderBy: { startTime: 'asc' },
    select: { week: true, season: true },
  })
  if (!next?.week || !next.season || next.week <= 1) return null
  const season = next.season
  const week = next.week - 1

  const teams = await prisma.leagueTeam.findMany({
    where: { claimedByUserId: userId, externalId: { not: '' }, league: { platform: 'sleeper', sport: 'NFL', season } },
    select: { leagueId: true, externalId: true, league: { select: { name: true } } },
  })
  const rosterByLeague = new Map<string, number>()
  const names = new Map<string, string>()
  for (const t of teams) {
    const roster = Number(t.externalId)
    if (!Number.isInteger(roster)) continue
    rosterByLeague.set(t.leagueId, roster)
    names.set(t.leagueId, (t.league.name ?? '').trim() || 'League')
  }
  if (rosterByLeague.size === 0) return null

  const rows = await prisma.leaguePlayerWeeklyScore.findMany({
    where: { leagueId: { in: [...rosterByLeague.keys()] }, seasonYear: season, week, isStarter: true },
    select: { leagueId: true, playerId: true, rosterId: true, points: true },
  })
  const mine = rows.filter((r) => r.rosterId != null && rosterByLeague.get(r.leagueId) === r.rosterId)
  const mvp = pickMvp(mine, names)
  if (!mvp) return null

  const ids = [mvp.playerId, ...(mvp.runnerUp ? [mvp.runnerUp.playerId] : [])]
  const players = await resolveSleeperPlayers(ids).catch(() => new Map())
  const p = players.get(mvp.playerId)
  if (!p) return null
  const r = mvp.runnerUp ? players.get(mvp.runnerUp.playerId) : null
  return {
    season,
    week,
    player: { sleeperId: p.sleeperId, name: p.name, position: p.position, team: p.team, imageUrl: p.imageUrl, ref: p.ref },
    points: mvp.points,
    leagues: mvp.leagues,
    runnerUp: mvp.runnerUp && r ? { name: r.name, points: mvp.runnerUp.points } : null,
    leaguesRead: new Set(mine.map((m) => m.leagueId)).size,
  }
}
