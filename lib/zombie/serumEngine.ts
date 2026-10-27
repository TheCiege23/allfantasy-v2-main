import type { ZombieChimmyAction } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getZombieLeagueConfig } from '@/lib/zombie/ZombieLeagueConfig'
import { getSerumBalance, useSerumToRevive } from '@/lib/zombie/ZombieSerumEngine'
import { notifyCommissioner } from '@/lib/zombie/commissionerNotificationService'
import { validatePreScoringWindow } from '@/lib/zombie/ambushEngine'
import { setRevived } from '@/lib/zombie/ZombieOwnerStatusService'
import { appendZombieAudit } from '@/lib/zombie/ZombieAuditLog'
import { queueAnimation } from '@/lib/zombie/animationEngine'

async function rosterLostWeek(leagueId: string, userId: string, week: number, seasonYear: number): Promise<boolean> {
  const season = await prisma.redraftSeason.findFirst({ where: { leagueId, season: seasonYear } })
  if (!season) return false
  const rr = await prisma.redraftRoster.findFirst({ where: { seasonId: season.id, ownerId: userId } })
  if (!rr) return false
  const m = await prisma.redraftMatchup.findFirst({
    where: {
      seasonId: season.id,
      week,
      OR: [{ homeRosterId: rr.id }, { awayRosterId: rr.id }],
    },
  })
  if (!m || !m.awayRosterId) return false
  const hs = m.homeScore ?? 0
  const as = m.awayScore ?? 0
  if (m.homeRosterId === rr.id) return hs < as
  return as < hs
}

export async function processSerumAction(
  leagueId: string,
  userId: string,
  rawMessage: string,
  week: number,
): Promise<ZombieChimmyAction> {
  const z = await prisma.zombieLeague.findUnique({ where: { leagueId } })
  if (!z) throw new Error('Zombie league not found')

  const timing = await validatePreScoringWindow(leagueId, week, z.season)
  const log = await prisma.zombieChimmyAction.create({
    data: {
      leagueId,
      userId,
      week,
      actionType: 'serum_use',
      rawMessage,
      isValid: timing.valid,
      validationError: timing.valid ? null : timing.reason ?? 'timing',
      privateResponse: timing.valid
        ? undefined
        : '⚠️ That action cannot be used at this time.',
    },
  })
  if (!timing.valid) return log

  const roster = await prisma.roster.findFirst({ where: { leagueId, platformUserId: userId } })
  if (!roster) throw new Error('Not in league')
  const team = await prisma.zombieLeagueTeam.findUnique({
    where: { leagueId_rosterId: { leagueId, rosterId: roster.id } },
    include: { items: true },
  })
  if (team?.status !== 'Survivor' || team.items.some((i) => i.activationState === 'pending_activation' && i.activatesAtWeek === week)) {
    await prisma.zombieChimmyAction.update({ where: { id: log.id }, data: {
      isValid: false, validationError: 'already_protected',
      privateResponse: '⚠️ Only an unprotected Survivor can register one serum for the week.',
    } })
    return prisma.zombieChimmyAction.findUniqueOrThrow({ where: { id: log.id } })
  }
  const serum = team.items.find(
    (i) => i.itemType.includes('serum') && !i.isUsed && i.activationState === 'ready',
  )
  if (!serum) {
    await prisma.zombieChimmyAction.update({
      where: { id: log.id },
      data: {
        isValid: false,
        validationError: 'no_serum',
        privateResponse: "⚠️ You don't have an unused serum.",
      },
    })
    return prisma.zombieChimmyAction.findUniqueOrThrow({ where: { id: log.id } })
  }

  await prisma.zombieTeamItem.update({
    where: { id: serum.id },
    data: { activationState: 'pending_activation', activatesAtWeek: week },
  })

  await prisma.zombieChimmyAction.update({
    where: { id: log.id },
    data: {
      isValid: true,
      publicResponse: '🧪 A serum has been registered. The infection may yet be stopped.',
      privateResponse: `Your serum is registered for Week ${week}. It is spent only if it prevents infection.`,
      effect: { itemId: serum.id },
    },
  })

  await notifyCommissioner(leagueId, 'serum_used', 'Serum registered', `Week ${week} — a player registered serum use.`, {
    week,
    relatedUserId: userId,
  })

  return prisma.zombieChimmyAction.findUniqueOrThrow({ where: { id: log.id } })
}

export async function processRevive(leagueId: string, userId: string, week: number): Promise<void> {
  const z = await prisma.zombieLeague.findUnique({ where: { leagueId } })
  if (!z) throw new Error('Zombie league not found')
  const config = await getZombieLeagueConfig(leagueId)
  const cost = config?.serumReviveCount ?? 2
  const roster = await prisma.roster.findFirst({ where: { leagueId, platformUserId: userId } })
  if (!roster) throw new Error('Not in league')
  const team = await prisma.zombieLeagueTeam.findUnique({
    where: { leagueId_rosterId: { leagueId, rosterId: roster.id } },
  })
  if (team?.status !== 'Zombie') throw new Error('Revive only for zombies')

  // Native leagues keep inventory as individual items; imported leagues may still use the resource ledger.
  // Never add the two stores together: some migration paths mirror the same award in both.
  const available = await prisma.zombieTeamItem.count({
    where: { teamStatusId: team.id, itemType: { contains: 'serum' }, isUsed: false, isExpired: false, activationState: 'ready' },
  })
  const spentNativeItems = available >= cost
  if (spentNativeItems) {
    await prisma.$transaction(async (tx) => {
      const items = await tx.zombieTeamItem.findMany({
        where: { teamStatusId: team.id, itemType: { contains: 'serum' }, isUsed: false, isExpired: false, activationState: 'ready' },
        orderBy: { id: 'asc' },
        take: cost,
        select: { id: true },
      })
      if (items.length !== cost) throw new Error('Serum balance changed during revival')
      const spent = await tx.zombieTeamItem.updateMany({
        where: { id: { in: items.map((item) => item.id) }, isUsed: false },
        data: { isUsed: true, usedAtWeek: week, usedEffect: 'revive' },
      })
      if (spent.count !== cost) throw new Error('Serum balance changed during revival')
      const revived = await tx.zombieLeagueTeam.updateMany({
        where: { id: team.id, status: 'Zombie' },
        data: { status: 'Survivor', revivedAt: new Date(), weekBecameZombie: null, killedByRosterId: null },
      })
      if (revived.count !== 1) throw new Error('Zombie status changed during revival')
    })
  } else {
    const ledgerBalance = await getSerumBalance(leagueId, roster.id)
    if (ledgerBalance < cost) throw new Error(`You need ${cost} serums to revive. You have ${Math.max(available, ledgerBalance)}.`)
    if (!(await useSerumToRevive(leagueId, roster.id, z.id))) throw new Error('Serum balance changed during revival')
  }

  await queueAnimation(leagueId, week, 'player_revived', userId, { revive: true })
  await notifyCommissioner(leagueId, 'revive_occurred', 'Zombie revived', `Week ${week} — player returned as revived survivor.`, {
    urgency: 'high', week, relatedUserId: userId,
  })
  if (spentNativeItems) await appendZombieAudit({
    leagueId, zombieLeagueId: z.id, universeId: z.universeId,
    eventType: 'revive', metadata: { userId, week, serumCount: cost },
  })
}

export async function autoReviveEligibleZombies(leagueId: string, week: number): Promise<number> {
  const config = await getZombieLeagueConfig(leagueId)
  if (!config?.autoSerumRevive) return 0
  const teams = await prisma.zombieLeagueTeam.findMany({
    where: { leagueId, status: 'Zombie' },
    select: { id: true, rosterId: true },
  })
  let revived = 0
  for (const team of teams) {
    const items = await prisma.zombieTeamItem.count({
      where: { teamStatusId: team.id, itemType: { contains: 'serum' }, isUsed: false, isExpired: false, activationState: 'ready' },
    })
    const ledger = items >= config.serumReviveCount ? 0 : await getSerumBalance(leagueId, team.rosterId)
    if (Math.max(items, ledger) < config.serumReviveCount) continue
    const roster = await prisma.roster.findUnique({ where: { id: team.rosterId }, select: { platformUserId: true } })
    if (!roster?.platformUserId) continue
    await processRevive(leagueId, roster.platformUserId, week)
    revived++
  }
  return revived
}

/** After infections run: consume/refund pending serums for the scoring week. */
export async function finalizePendingSerumsForWeek(leagueId: string, week: number, seasonYear: number): Promise<void> {
  const z = await prisma.zombieLeague.findUnique({ where: { leagueId } })
  if (!z) return

  const pending = await prisma.zombieTeamItem.findMany({
    where: {
      activationState: 'pending_activation',
      activatesAtWeek: week,
      team: { zombieLeagueId: z.id },
    },
    include: { team: true },
  })

  for (const item of pending) {
    const uid =
      item.userId ||
      (
        await prisma.roster.findUnique({
          where: { id: item.team.rosterId },
          select: { platformUserId: true },
        })
      )?.platformUserId
    if (!uid) continue
    const lost = await rosterLostWeek(leagueId, uid, week, seasonYear)
    if (lost) {
      await prisma.zombieTeamItem.update({
        where: { id: item.id },
        data: { isUsed: true, usedAtWeek: week, activationState: 'ready' },
      })
      const roster = await prisma.roster.findFirst({ where: { leagueId, platformUserId: uid } })
      if (roster) {
        const t = await prisma.zombieLeagueTeam.findUnique({
          where: { leagueId_rosterId: { leagueId, rosterId: roster.id } },
        })
        if (t?.status === 'Zombie') {
          await setRevived(leagueId, roster.id)
        }
      }
      await queueAnimation(leagueId, week, 'serum_used', uid, { serum: true })
    } else {
      await prisma.zombieTeamItem.update({
        where: { id: item.id },
        data: { activationState: 'ready', activatesAtWeek: null },
      })
    }
  }
}
