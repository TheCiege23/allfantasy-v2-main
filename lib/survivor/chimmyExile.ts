import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isChimmyRunning } from '@/lib/inactive-manager/inactiveManagerMode'
import { readPlayableChimmyLineups } from '@/lib/inactive-manager/chimmyPlayable'
import { buildLeagueStatScorer } from '@/lib/redraft/scoringEngine'
import { exileFirstGames, exileTeamKey, exileWeekWindow, getExileWaivers, mutateExileRoster } from './exileRosterService'
import { chimmyExilePlan, type ExileCandidate } from './chimmyExileStrategy'
import { postChimmyCastawayLine } from './chimmyCastawayChat'

export { chimmyExilePlan, type ChimmyExilePlan, type ExileCandidate } from './chimmyExileStrategy'

/** How many finalized weeks of a player's scoring Chimmy reads to judge a team. */
export const CHIMMY_EXILE_FORM_WEEKS = 3

const SEAT_PREFIX = 'orphan-'

/**
 * How long Chimmy waits before trying a castaway's Exile pick again after an attempt that came to
 * nothing (no team open, no legal lineup, a claim refused, Exile not open yet). A full attempt reads
 * every active player in the sport and their recent scores, and the season runner calls this on
 * every tick: without a pause, a week with nothing to claim repeats that read until the week ends.
 * Cheap answers — a team already reserved, a roster locked — need no pause. Per process: the worker's
 * replicas each keep their own, which at worst doubles the attempts and never blocks a real claim
 * for longer than this.
 */
export const CHIMMY_EXILE_RETRY_MS = 30 * 60 * 1000
const NO_PAUSE = new Set(['already_set', 'locked', 'cooling_down', 'no_scoring_rules'])
const retryAfter = new Map<string, number>()

/** Tests only: forget every pause. */
export function resetChimmyExileRetries(): void {
  retryAfter.clear()
}

/**
 * Every id a player's weekly scores may be stored under. Exile claims a `Player` row, but a league's
 * roster — and so the score sync — keys a player by its draft pool's provider id (Sleeper's `12527`
 * for NFL, held on the row as `providerIds.sleeper = "sleeper:12527"`). Reading only `Player.id` saw
 * no form for anyone, and every team tied. Measured on the season rehearsal: 0 of 192 drafted ids
 * matched a `Player.id`.
 */
export function playerScoreAliases(player: { id: string; providerIds?: unknown }): string[] {
  const ids = new Set([player.id])
  const provider = player.providerIds
  if (provider && typeof provider === 'object' && !Array.isArray(provider)) {
    for (const value of Object.values(provider as Record<string, unknown>)) {
      if (typeof value !== 'string' && typeof value !== 'number') continue
      const raw = String(value).trim()
      if (!raw) continue
      ids.add(raw)
      // "sleeper:12527" → "12527"; a multi-part key ("name:Ashton Jeanty:RB:LV") is not an id.
      const prefixed = /^[a-z_]+:([^:]+)$/i.exec(raw)
      if (prefixed) ids.add(prefixed[1])
    }
  }
  return [...ids]
}

/**
 * Chimmy's Exile form, pure: each player's average fantasy points per finalized week across `scores`
 * (already narrowed to the form weeks) under `scorer`. A score row belongs to the first player whose
 * aliases (playerScoreAliases) include its id; the same week under two of a player's ids counts once,
 * at the higher reading. A player with no row has form 0. Exported so the season rehearsal can rank
 * every open team by the same measure Chimmy picks with.
 */
export function exileCandidatesFromScores(
  players: ReadonlyArray<{ id: string; name: string; position: string; team: string | null; providerIds?: unknown }>,
  scores: ReadonlyArray<{ playerId: string; week: number; stats: unknown }>,
  scorer: (stats: Record<string, number>, position: string | null) => number,
): ExileCandidate[] {
  const ownerOf = new Map<string, string>()
  for (const p of players) for (const alias of playerScoreAliases(p)) if (!ownerOf.has(alias)) ownerOf.set(alias, p.id)
  const weekly = new Map<string, Map<number, number>>()
  const positionOf = new Map(players.map((p) => [p.id, p.position]))
  for (const row of scores) {
    const owner = ownerOf.get(row.playerId)
    if (!owner || !row.stats || typeof row.stats !== 'object' || Array.isArray(row.stats)) continue
    const points = scorer(row.stats as Record<string, number>, positionOf.get(owner) ?? null)
    if (!Number.isFinite(points)) continue
    const weeks = weekly.get(owner) ?? new Map<number, number>()
    weeks.set(row.week, Math.max(weeks.get(row.week) ?? -Infinity, points))
    weekly.set(owner, weeks)
  }
  const totals = new Map([...weekly].map(([id, weeks]) => [id, { sum: [...weeks.values()].reduce((a, b) => a + b, 0), weeks: weeks.size }]))
  return players
    .filter((p): p is typeof p & { team: string } => Boolean(p.team))
    .map((p) => {
      const t = totals.get(p.id)
      return { id: p.id, name: p.name, position: p.position, team: p.team, recentPoints: t ? t.sum / t.weeks : 0 }
    })
}

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
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true, season: true, settings: true, userId: true } })
  if (!league) return turn
  const managed = await readPlayableChimmyLineups(league)
  const chimmy = exiled.filter((p) => isChimmyRunning(managed, p.redraftRosterId ?? p.userId.slice(SEAT_PREFIX.length), p.userId))
  if (chimmy.length === 0) return turn
  const scorer = buildLeagueStatScorer(league)
  if (!scorer) {
    for (const p of chimmy) turn.skipped[p.userId] = 'no_scoring_rules'
    return turn
  }

  const exileTurnFor = async (castaway: { userId: string }): Promise<void> => {
    let waivers: Awaited<ReturnType<typeof getExileWaivers>>
    try {
      waivers = await getExileWaivers(leagueId, castaway.userId, '', now)
    } catch (error) {
      turn.skipped[castaway.userId] = error instanceof Error ? error.message : 'exile_closed'
      return
    }
    if (waivers.roster.team) { turn.skipped[castaway.userId] = 'already_set'; return }
    if (waivers.locked) { turn.skipped[castaway.userId] = 'locked'; return }
    const window = await exileWeekWindow(prisma as unknown as Prisma.TransactionClient, league.sport, league.season, waivers.week)
    if (!window) { turn.skipped[castaway.userId] = 'no_calendar'; return }

    // A team can be reserved only until its first game of the period starts. The same games, and the
    // same team key, the Exile claim itself checks — so a daily sport's full team names match.
    const firstGame = await exileFirstGames(prisma as unknown as Prisma.TransactionClient, league.sport, league.season, waivers.week, window.start, window.end)
    const openKeys = new Set([...firstGame].filter(([, start]) => start > now).map(([key]) => key))
    const taken = waivers.takenTeamIds.map((t) => t.toUpperCase())
    if (openKeys.size === 0) { turn.skipped[castaway.userId] = 'no_open_team'; return }

    const players = (await prisma.player.findMany({
      where: { sport: { equals: league.sport, mode: 'insensitive' }, active: true, team: { not: null } },
      select: { id: true, name: true, position: true, team: true, providerIds: true },
    })).filter((p) => p.team && openKeys.has(exileTeamKey(league.sport, p.team)))
    // Exile reserves a team under the player row's own spelling (upper-cased), so that is the name the plan uses.
    const openTeams = [...new Set(players.map((p) => p.team!.trim().toUpperCase()))].filter((t) => !taken.includes(t))
    if (openTeams.length === 0) { turn.skipped[castaway.userId] = 'no_open_team'; return }
    const scores = await prisma.playerWeeklyScore.findMany({
      where: {
        playerId: { in: [...new Set(players.flatMap((p) => playerScoreAliases(p)))] }, sport: league.sport, season: league.season, isFinalized: true,
        week: { gte: waivers.week - CHIMMY_EXILE_FORM_WEEKS, lt: waivers.week },
      },
      select: { playerId: true, week: true, stats: true },
    })
    const candidates = exileCandidatesFromScores(players, scores, scorer)
    const plan = chimmyExilePlan(candidates, league.sport, league.settings, openTeams, taken)
    if (!plan) { turn.skipped[castaway.userId] = 'no_legal_roster'; return }

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
    if (claimed > 0) {
      turn.claimed[castaway.userId] = { team: plan.team, expected: plan.expected, players: claimed }
      await postChimmyCastawayLine(leagueId, castaway.userId, { kind: 'exile', team: plan.team })
    }
  }

  for (const castaway of chimmy) {
    const pauseKey = `${leagueId}:${castaway.userId}`
    if ((retryAfter.get(pauseKey) ?? 0) > now.getTime()) { turn.skipped[castaway.userId] = 'cooling_down'; continue }
    await exileTurnFor(castaway)
    if (turn.claimed[castaway.userId]) retryAfter.delete(pauseKey)
    else if (turn.skipped[castaway.userId] && !NO_PAUSE.has(turn.skipped[castaway.userId])) retryAfter.set(pauseKey, now.getTime() + CHIMMY_EXILE_RETRY_MS)
  }
  return turn
}
