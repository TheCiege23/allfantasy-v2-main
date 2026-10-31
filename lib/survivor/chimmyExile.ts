import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isChimmyRunning, readManagedLineups } from '@/lib/inactive-manager/inactiveManagerMode'
import { buildLeagueStatScorer } from '@/lib/redraft/scoringEngine'
import { exileWeekWindow, getExileWaivers, mutateExileRoster } from './exileRosterService'
import { chimmyExilePlan, type ExileCandidate } from './chimmyExileStrategy'

export { chimmyExilePlan, type ChimmyExilePlan, type ExileCandidate } from './chimmyExileStrategy'

/** How many finalized weeks of a player's scoring Chimmy reads to judge a team. */
export const CHIMMY_EXILE_FORM_WEEKS = 3

const SEAT_PREFIX = 'orphan-'

export type ChimmyExileTurn = { claimed: Record<string, { team: string; expected: number; players: number }>; skipped: Record<string, string> }

/**
 * Chimmy's Exile Island turn, for every exiled castaway it runs: once per Exile period, reserve the best
 * open real team and claim its best legal starting lineup (./chimmyExileStrategy). It claims through
 * the same Exile waiver service a person uses, so every rule — one team per manager, nobody else's
 * reserved team, no team whose first game has started — still applies.
 *
 * Idempotent: a castaway that already reserved a team this period is left alone. Called by the season
 * runner on every tick; a failure never holds up the island.
 */
export async function runChimmyExileTurn(leagueId: string, now = new Date()): Promise<ChimmyExileTurn> {
  const turn: ChimmyExileTurn = { claimed: {}, skipped: {} }
  const exiled = await prisma.survivorPlayer.findMany({
    where: { leagueId, playerState: 'exile', userId: { startsWith: SEAT_PREFIX } },
    select: { userId: true, redraftRosterId: true },
  })
  if (exiled.length === 0) return turn
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true, season: true, settings: true } })
  if (!league) return turn
  const managed = readManagedLineups(league.settings)
  const chimmy = exiled.filter((p) => isChimmyRunning(managed, p.redraftRosterId ?? p.userId.slice(SEAT_PREFIX.length), p.userId))
  if (chimmy.length === 0) return turn
  const scorer = buildLeagueStatScorer(league)
  if (!scorer) {
    for (const p of chimmy) turn.skipped[p.userId] = 'no_scoring_rules'
    return turn
  }

  for (const castaway of chimmy) {
    let waivers: Awaited<ReturnType<typeof getExileWaivers>>
    try {
      waivers = await getExileWaivers(leagueId, castaway.userId, '', now)
    } catch (error) {
      turn.skipped[castaway.userId] = error instanceof Error ? error.message : 'exile_closed'
      continue
    }
    if (waivers.roster.team) { turn.skipped[castaway.userId] = 'already_set'; continue }
    if (waivers.locked) { turn.skipped[castaway.userId] = 'locked'; continue }
    const window = await exileWeekWindow(prisma as unknown as Prisma.TransactionClient, league.sport, league.season, waivers.week)
    if (!window) { turn.skipped[castaway.userId] = 'no_calendar'; continue }

    // A team can be reserved only until its first game of the period starts.
    const games = await prisma.gameSchedule.findMany({
      where: { sportType: league.sport, startTime: { gte: window.start, lt: window.end } },
      select: { homeTeam: true, awayTeam: true, startTime: true },
    })
    const firstGame = new Map<string, Date>()
    for (const g of games) {
      for (const team of [g.homeTeam, g.awayTeam]) {
        const code = team?.trim().toUpperCase()
        if (!code || !g.startTime) continue
        const seen = firstGame.get(code)
        if (!seen || g.startTime < seen) firstGame.set(code, g.startTime)
      }
    }
    const taken = waivers.takenTeamIds.map((t) => t.toUpperCase())
    const openTeams = [...firstGame].filter(([team, start]) => start > now && !taken.includes(team)).map(([team]) => team)
    if (openTeams.length === 0) { turn.skipped[castaway.userId] = 'no_open_team'; continue }

    const players = await prisma.player.findMany({
      where: { sport: { equals: league.sport, mode: 'insensitive' }, active: true, team: { in: openTeams, mode: 'insensitive' } },
      select: { id: true, name: true, position: true, team: true },
    })
    const scores = await prisma.playerWeeklyScore.findMany({
      where: {
        playerId: { in: players.map((p) => p.id) }, sport: league.sport, season: league.season, isFinalized: true,
        week: { gte: waivers.week - CHIMMY_EXILE_FORM_WEEKS, lt: waivers.week },
      },
      select: { playerId: true, stats: true },
    })
    const totals = new Map<string, { sum: number; weeks: number }>()
    const positionOf = new Map(players.map((p) => [p.id, p.position]))
    for (const row of scores) {
      if (!row.stats || typeof row.stats !== 'object' || Array.isArray(row.stats)) continue
      const points = scorer(row.stats as Record<string, number>, positionOf.get(row.playerId) ?? null)
      if (!Number.isFinite(points)) continue
      const t = totals.get(row.playerId) ?? { sum: 0, weeks: 0 }
      totals.set(row.playerId, { sum: t.sum + points, weeks: t.weeks + 1 })
    }
    const candidates: ExileCandidate[] = players
      .filter((p): p is typeof p & { team: string } => Boolean(p.team))
      .map((p) => {
        const t = totals.get(p.id)
        return { id: p.id, name: p.name, position: p.position, team: p.team, recentPoints: t ? t.sum / t.weeks : 0 }
      })
    const plan = chimmyExilePlan(candidates, league.sport, league.settings, openTeams, taken)
    if (!plan) { turn.skipped[castaway.userId] = 'no_legal_roster'; continue }

    let claimed = 0
    for (const pick of plan.picks) {
      try {
        await mutateExileRoster({ leagueId, userId: castaway.userId, week: waivers.week, playerId: pick.id, action: 'claim', slot: pick.slot }, now)
        claimed++
      } catch (error) {
        // The anchor is what reserves the team: if it fails, nothing was claimed and the next tick retries.
        if (claimed === 0) { turn.skipped[castaway.userId] = error instanceof Error ? error.message : 'claim_failed'; break }
      }
    }
    if (claimed > 0) turn.claimed[castaway.userId] = { team: plan.team, expected: plan.expected, players: claimed }
  }
  return turn
}
