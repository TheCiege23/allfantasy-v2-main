import type { ZombieChimmyAction } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getZombieRulesForLeague } from '@/lib/zombie/zombieRules'
import { notifyCommissioner } from '@/lib/zombie/commissionerNotificationService'
import { validateAmbushTiming } from '@/lib/zombie/ambushEngine'
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

  const timing = await validateAmbushTiming(leagueId, week, z.sport)
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
  const serum = team?.items.find(
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
      privateResponse: `Your serum is registered for Week ${week}. If you lose, you will NOT be infected.`,
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
  const rules = await getZombieRulesForLeague(leagueId, z.sport)

  const roster = await prisma.roster.findFirst({ where: { leagueId, platformUserId: userId } })
  if (!roster) throw new Error('Not in league')
  const team = await prisma.zombieLeagueTeam.findUnique({
    where: { leagueId_rosterId: { leagueId, rosterId: roster.id } },
    include: { items: true },
  })
  if (!team || !team.status.toLowerCase().includes('zombie')) {
    throw new Error('Revive only for zombies')
  }

  const count = await prisma.zombieTeamItem.count({
    where: {
      teamStatusId: team.id,
      itemType: { contains: 'serum' },
      isUsed: false,
    },
  })
  if (count < rules.reviveThreshold) {
    throw new Error(`You need ${rules.reviveThreshold} serums to revive. You have ${count}.`)
  }

  const serums = await prisma.zombieTeamItem.findMany({
    where: { teamStatusId: team.id, itemType: { contains: 'serum' }, isUsed: false },
  })
  for (const s of serums) {
    await prisma.zombieTeamItem.update({ where: { id: s.id }, data: { isUsed: true, usedAtWeek: week } })
  }

  await setRevived(leagueId, roster.id)
  await queueAnimation(leagueId, week, 'player_revived', userId, { revive: true })
  await notifyCommissioner(leagueId, 'revive_occurred', 'Zombie revived', `Week ${week} — player returned as revived survivor.`, {
    urgency: 'high',
    week,
    relatedUserId: userId,
  })
  await appendZombieAudit({
    leagueId,
    zombieLeagueId: z.id,
    universeId: z.universeId,
    eventType: 'revive',
    metadata: { userId, week },
  })
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
