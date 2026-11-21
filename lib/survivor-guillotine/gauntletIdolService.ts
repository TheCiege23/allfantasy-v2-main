import 'server-only'
import { verifiedSGInactivePlayer } from './playerCatalog'
import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { buildSGSchedule } from './config'
import { getRosterPlayerIds, removePlayerFromRosterData } from '@/lib/waiver-wire/roster-utils'
import type { SGConfig } from './types'
import { sgGameWindow } from './gameWindow'

/** Announce one real, unowned retired-player token. Normal league FAAB awards its ownership. */
export async function prepareSGRetiredIdol(tx: Prisma.TransactionClient, leagueId: string, config: SGConfig,
  period: number, playerId?: string | null) {
  if (config.gauntletIdolMode !== 'retired_player' || !buildSGSchedule(config).periods.some(p => p.period === period && p.mode === 'gauntlet')) return
  const circulating = await tx.survivorGuillotinePower.findFirst({ where: { leagueId, source: 'gauntlet_retired', status: { in: ['held', 'sealed'] } } })
  if (circulating) {
    // Future calendar choices are replacement candidates, used only after the circulating idol is spent.
    return
  }
  if (await tx.survivorGuillotinePower.count({ where: { leagueId, source: 'gauntlet_retired', activationPeriod: period, status: 'used' } })) return
  if (!playerId) throw new Error('Select the retired player carrying this period’s Gauntlet idol before opening the period.')
  const player = await verifiedSGInactivePlayer(tx, config.sport, playerId)
  if (!player) throw new Error('Choose a verified inactive/retired player in this sport.')
  const rosters = await tx.roster.findMany({ where: { leagueId }, select: { playerData: true } })
  if (rosters.some(r => getRosterPlayerIds(r.playerData).includes(playerId))) throw new Error('The newly announced retired player must begin in the waiver pool.')
  if (await tx.survivorGuillotinePower.count({ where: { leagueId, playerId, source: { not: 'gauntlet_retired' }, status: { in: ['held', 'sealed'] } } })) throw new Error('Choose another retired player for this idol.')
  const expires = Math.max(...buildSGSchedule(config).periods.filter(p => p.mode === 'gauntlet').map(p => p.period))
  await tx.survivorGuillotinePower.create({ data: { id: randomUUID(), leagueId, playerId,
    kind: 'personal_immunity', binding: 'player', source: 'gauntlet_retired',
    activationPeriod: period, expiresAfterPeriod: expires } })
  const league = await tx.league.findUniqueOrThrow({ where: { id: leagueId }, select: { userId: true } })
  await tx.leagueChatMessage.create({ data: { leagueId, userId: league.userId, type: 'system',
    message: `${player.name} carries the Gauntlet idol. Win the player through league FAAB waivers, then use the idol to drop the player and announce immunity before the first game of the period.`,
    metadata: { survivorGuillotine: true, event: 'gauntlet_idol_available', period, playerId } } })
}

/** Ownership, dropping, announcement, and protection are one serializable operation. */
export async function activateSGRetiredIdol(leagueId: string, userId: string, powerId: string) {
  return prisma.$transaction(async tx => {
    const season = await tx.survivorGuillotineLeague.findUniqueOrThrow({ where: { leagueId } })
    const config = season.config as unknown as SGConfig
    const state = season.periodState as { period: number; ceremonyStarted?: boolean; scoringStartsAt?: string; scoringEndsAt?: string }
    if (config.gauntletIdolMode !== 'retired_player' || season.status !== 'active' || state?.ceremonyStarted ||
        state?.period !== season.currentPeriod || !buildSGSchedule(config).periods.some(p => p.period === state.period && p.mode === 'gauntlet')) throw new Error('The retired-player idol is only playable during the Gauntlet.')
    const power = await tx.survivorGuillotinePower.findFirst({ where: { id: powerId, leagueId, source: 'gauntlet_retired', status: 'held' } })
    if (!power?.playerId || power.expiresAfterPeriod < state.period) throw new Error('This Gauntlet idol is unavailable.')
    const league = await tx.league.findUniqueOrThrow({ where: { id: leagueId }, select: { season: true, sport: true, userId: true } })
    const firstGame = await tx.gameSchedule.findFirst({ where: { sportType: league.sport, season: league.season,
      ...sgGameWindow(config.sport, state.period, state.scoringStartsAt, state.scoringEndsAt) }, orderBy: { startTime: 'asc' }, select: { startTime: true } })
    if (!firstGame?.startTime || Date.now() >= firstGame.startTime.getTime()) throw new Error('The Gauntlet idol must be dropped and announced before the first kickoff/tip-off.')
    const team = await tx.leagueTeam.findFirst({ where: { leagueId, claimedByUserId: userId, eliminatedAt: null }, select: { externalId: true, teamName: true } })
    if (!team?.externalId) throw new Error('Only an active manager can play the Gauntlet idol.')
    const roster = await tx.roster.findUniqueOrThrow({ where: { id: team.externalId }, select: { playerData: true, redraftRosterId: true } })
    if (!getRosterPlayerIds(roster.playerData).includes(power.playerId) || !roster.redraftRosterId) throw new Error('Win and roster the announced retired player before using the idol.')
    const claim = await tx.survivorGuillotineLeague.updateMany({ where: { leagueId, revision: season.revision }, data: { revision: { increment: 1 } } })
    if (claim.count !== 1) throw new Error('The season changed; reload before playing the idol.')
    const now = new Date()
    await tx.roster.update({ where: { id: team.externalId }, data: { playerData: removePlayerFromRosterData(roster.playerData, power.playerId) as Prisma.InputJsonValue } })
    const dropped = await tx.redraftRosterPlayer.updateMany({ where: { rosterId: roster.redraftRosterId, playerId: power.playerId, droppedAt: null }, data: { droppedAt: now } })
    if (dropped.count !== 1) throw new Error('The retired player ownership record needs reconciliation.')
    await tx.afRosterLineupAssignment.deleteMany({ where: { leagueId, rosterId: team.externalId,
      season: league.season, week: { gte: state.period }, playerId: power.playerId } })
    const activated = await tx.survivorGuillotinePower.updateMany({ where: { id: power.id, leagueId, status: 'held' },
      data: { binding: 'manager', ownerUserId: userId, status: 'sealed', targetRosterId: team.externalId,
        activatedAt: now, revealedAt: now, activationPeriod: state.period } })
    if (activated.count !== 1) throw new Error('This idol was already played.')
    await tx.leagueChatMessage.create({ data: { leagueId, userId, type: 'system',
      message: `${team.teamName || 'A manager'} dropped the retired player and played the Gauntlet idol. Their chop will pass to the next eligible manager.`,
      metadata: { survivorGuillotine: true, event: 'gauntlet_idol_played', period: state.period,
        targetRosterId: team.externalId, playerId: power.playerId } } })
    return { reply: 'The retired player was dropped and your Gauntlet immunity was announced.', powerId }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000, maxWait: 10000 })
}
