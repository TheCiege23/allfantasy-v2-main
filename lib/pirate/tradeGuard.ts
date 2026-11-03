import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isPirateLeague, isProtectionLocked, protectedIds } from './rules'

type TradeDb = Pick<PrismaClient,
  'league' | 'redraftSeason' | 'redraftMatchup' | 'gameSchedule' | 'fantasyScheduleGame' | 'pirateProtectionSet'>

export type PirateTradeAsset = {
  fromRosterId: string
  assetType: string
  playerId?: string | null
}

/**
 * After the first game of a scoring period, player trades must exchange
 * protected players from both teams. Checks at proposal AND settlement.
 */
export async function assertPirateTradeAllowed(
  leagueId: string,
  assets: PirateTradeAsset[],
  db: TradeDb = prisma,
  now = new Date(),
): Promise<void> {
  const league = await db.league.findUnique({
    where: { id: leagueId },
    select: { leagueType: true, leagueVariant: true, sport: true, season: true },
  })
  if (!league || !isPirateLeague(league)) return
  const players = assets.filter((asset) => asset.assetType === 'player' && asset.playerId)
  if (!players.length) return
  const season = await db.redraftSeason.findFirst({
    where: { leagueId },
    orderBy: [{ season: 'desc' }, { createdAt: 'desc' }],
    select: { id: true, season: true, currentWeek: true },
  })
  if (!season) throw new Error('Pirate trade cannot be verified without a league season.')
  const current = Math.max(1, season.currentWeek)
  const matchups = await db.redraftMatchup.findMany({
    where: { seasonId: season.id, week: current, isMedianMatchup: false },
    select: { status: true },
  })
  const week = matchups.length > 0 && matchups.every((row) => row.status === 'final') ? current + 1 : current
  const [game, fantasy] = await Promise.all([
    db.gameSchedule.findFirst({
      where: { sportType: String(league.sport), season: season.season, weekOrRound: week, startTime: { not: null } },
      orderBy: { startTime: 'asc' }, select: { startTime: true },
    }),
    db.fantasyScheduleGame.findFirst({
      where: { sport: String(league.sport), season: String(season.season), week, kickoffTime: { not: null } },
      orderBy: { kickoffTime: 'asc' }, select: { kickoffTime: true },
    }),
  ])
  const dates = [game?.startTime, fantasy?.kickoffTime].filter((date): date is Date => date instanceof Date)
  const lockAt = dates.length ? new Date(Math.min(...dates.map((date) => date.getTime()))) : null
  if (!isProtectionLocked(lockAt, now)) return
  const fromIds = [...new Set(players.map((asset) => asset.fromRosterId))]
  if (fromIds.length !== 2) {
    throw new Error('During games, Pirate League player trades must exchange protected players from both teams.')
  }
  const sets = await db.pirateProtectionSet.findMany({
    where: { leagueId, seasonId: season.id, week, rosterId: { in: fromIds } },
    select: { rosterId: true, status: true, playerIds: true },
  })
  const protectedByRoster = new Map(sets.map((set) => [set.rosterId, new Set(protectedIds(set))]))
  for (const asset of players) {
    if (!protectedByRoster.get(asset.fromRosterId)?.has(asset.playerId!)) {
      throw new Error('During games, only protected-for-protected player trades are allowed.')
    }
  }
}
