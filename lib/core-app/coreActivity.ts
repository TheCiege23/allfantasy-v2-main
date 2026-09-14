import { prisma } from '@/lib/prisma'
import { normalizeGameStatus } from '@/lib/sports/gameStatus'

const LOOKBACK_MS = 7 * 60 * 60 * 1000
const LOOKAHEAD_MS = 45 * 60 * 1000

const EXPECTED_GAME_MS: Record<string, number> = {
  NFL: 4 * 60 * 60 * 1000,
  NCAAF: 4 * 60 * 60 * 1000,
  NBA: 3 * 60 * 60 * 1000,
  NCAAB: 3 * 60 * 60 * 1000,
  NHL: 3 * 60 * 60 * 1000,
  MLB: 4 * 60 * 60 * 1000,
  NCAABASE: 4 * 60 * 60 * 1000,
  SOCCER: 3 * 60 * 60 * 1000,
}
export type CoreActivitySnapshot = {
  gameDayActive: boolean
  liveGameCount: number
  draftLive: boolean
}

/**
 * One bounded read for the Core shell's refresh policy.
 *
 * A scheduled game whose kickoff has passed still opens the fast lane. Provider
 * status often arrives one poll after kickoff; waiting for it would leave every
 * Core screen on the two-minute idle cadence during the most important minute.
 * The visible LIVE badge remains stricter and counts only positively live rows.
 */
export async function getCoreActivitySnapshot(
  leagueIds: string[],
  sports: string[],
  now = new Date(),
): Promise<CoreActivitySnapshot> {
  const normalizedSports = [...new Set(sports.map((sport) => sport.trim().toUpperCase()).filter(Boolean))]
  const from = new Date(now.getTime() - LOOKBACK_MS)
  const to = new Date(now.getTime() + LOOKAHEAD_MS)

  const [games, liveDraftCount] = await Promise.all([
    normalizedSports.length > 0
      ? prisma.sportsGame.findMany({
          where: {
            sport: { in: normalizedSports },
            startTime: { gte: from, lte: to },
          },
          select: { sport: true, externalId: true, status: true, startTime: true, fetchedAt: true },
          orderBy: { fetchedAt: 'desc' },
          take: 400,
        })
      : Promise.resolve([]),
    leagueIds.length > 0
      ? prisma.draftSession.count({
          where: {
            leagueId: { in: [...new Set(leagueIds)] },
            status: { in: ['in_progress', 'paused', 'active', 'live'] },
          },
        })
      : Promise.resolve(0),
  ])

  // The table can hold the same fixture from several feeds. The newest row for
  // each source-independent game identity owns the shell signal.
  const distinct = new Map<string, (typeof games)[number]>()
  for (const game of games) {
    const key = `${game.sport}:${game.externalId}`
    if (!distinct.has(key)) distinct.set(key, game)
  }

  let liveGameCount = 0
  let gameDayActive = false
  for (const game of distinct.values()) {
    const status = normalizeGameStatus(game.status)
    if (status === 'live') {
      liveGameCount += 1
      gameDayActive = true
      continue
    }
    if (!game.startTime || status === 'final' || status === 'cancelled' || status === 'postponed') continue
    const elapsed = now.getTime() - game.startTime.getTime()
    const expected = EXPECTED_GAME_MS[game.sport.toUpperCase()] ?? 4 * 60 * 60 * 1000
    if (elapsed >= -LOOKAHEAD_MS && elapsed <= expected) gameDayActive = true
  }

  return { gameDayActive, liveGameCount, draftLive: liveDraftCount > 0 }
}
