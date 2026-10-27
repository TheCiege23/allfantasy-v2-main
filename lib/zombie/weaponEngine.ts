import { prisma } from '@/lib/prisma'
import { getZombieRulesForSport } from '@/lib/zombie/zombieRules'
import { validatePreScoringWindow } from '@/lib/zombie/ambushEngine'
import { getNativeMatchupOutcomes } from '@/lib/zombie/ZombieInfectionEngine'
import { notifyCommissioner, notifyZombiePlayer } from '@/lib/zombie/commissionerNotificationService'
import { queueAnimation } from '@/lib/zombie/animationEngine'
import { appendZombieAudit } from '@/lib/zombie/ZombieAuditLog'

async function ensureTeamItem(
  leagueId: string,
  userId: string,
  zombieLeagueId: string,
  itemType: string,
  label: string,
  week: number,
) {
  const roster = await prisma.roster.findFirst({ where: { leagueId, platformUserId: userId } })
  if (!roster) return
  const team = await prisma.zombieLeagueTeam.findUnique({
    where: { leagueId_rosterId: { leagueId, rosterId: roster.id } },
    include: { items: true },
  })
  if (!team) return
  if (team.items.some((i) => i.itemType === itemType && !i.isUsed)) return
  await prisma.zombieTeamItem.create({
    data: {
      teamStatusId: team.id,
      zombieLeagueId,
      userId,
      itemType,
      itemLabel: label,
      acquiredAtWeek: week,
    },
  })
  await notifyZombiePlayer(userId, 'weapon_earned', 'You earned a weapon', {
    severity: 'medium',
    body: `⚔️ You earned: ${label}.`,
    meta: { itemType, leagueId },
  }).catch(() => {})
}

export async function checkAndAwardWeapons(leagueId: string, week: number, zombieLeagueId: string): Promise<void> {
  const z = await prisma.zombieLeague.findUnique({ where: { id: zombieLeagueId } })
  if (!z) return
  const rules = await getZombieRulesForSport(z.sport)
  const season = await prisma.redraftSeason.findFirst({
    where: { leagueId, season: z.season },
  })
  if (!season) return

  const matchups = await prisma.redraftMatchup.findMany({
    where: { seasonId: season.id, week },
  })

  for (const m of matchups) {
    if (!m.awayRosterId) continue
    const hs = m.homeScore ?? 0
    const as = m.awayScore ?? 0
    for (const side of [
      { rid: m.homeRosterId, score: hs, won: hs >= as },
      { rid: m.awayRosterId, score: as, won: as >= hs },
    ]) {
      const rr = await prisma.redraftRoster.findUnique({
        where: { id: side.rid },
        select: { ownerId: true },
      })
      if (!rr) continue
      if (side.score >= rules.weaponShieldThreshold) {
        await ensureTeamItem(leagueId, rr.ownerId, zombieLeagueId, 'weapon_knife', '🔪 Knife', week)
      }
      if (side.score >= rules.weaponAmbushThreshold) {
        await ensureTeamItem(leagueId, rr.ownerId, zombieLeagueId, 'weapon_bow', '🏹 Bow', week)
      }
      if (side.won && Math.abs(hs - as) >= rules.weaponAxeMargin) {
        await ensureTeamItem(leagueId, rr.ownerId, zombieLeagueId, 'weapon_axe', '🪓 Axe', week)
      }
    }
  }

  const teams = await prisma.zombieLeagueTeam.findMany({ where: { leagueId } })
  for (const t of teams) {
    const roster = await prisma.roster.findUnique({
      where: { id: t.rosterId },
      select: { platformUserId: true },
    })
    const uid = roster?.platformUserId
    if (!uid) continue
    if (t.zombieAttacksSurvived >= 3) {
      await ensureTeamItem(leagueId, uid, zombieLeagueId, 'weapon_gun', '🔫 Gun', week)
    }
    if (t.survivorWinStreak >= 5) {
      await ensureTeamItem(leagueId, uid, zombieLeagueId, 'weapon_bomb', '💣 Bomb', week)
    }
  }
}

export async function processWeaponAction(
  leagueId: string,
  userId: string,
  rawMessage: string,
  week: number,
): Promise<{ id: string }> {
  const z = await prisma.zombieLeague.findUnique({ where: { leagueId } })
  if (!z) throw new Error('Zombie league not found')
  const timing = await validatePreScoringWindow(leagueId, week, z.season)
  const lower = rawMessage.toLowerCase()

  let weapon = 'weapon_axe'
  if (lower.includes('gun') || lower.includes('🔫')) weapon = 'weapon_gun'
  if (lower.includes('axe') || lower.includes('🪓')) weapon = 'weapon_axe'
  if (lower.includes('knife') || lower.includes('🔪')) weapon = 'weapon_knife'
  if (lower.includes('bow') || lower.includes('🏹')) weapon = 'weapon_bow'

  const log = await prisma.zombieChimmyAction.create({
    data: {
      leagueId,
      userId,
      week,
      actionType: 'weapon_use',
      rawMessage,
      isValid: timing.valid,
    },
  })
  if (!timing.valid) {
    await prisma.zombieChimmyAction.update({
      where: { id: log.id },
      data: { privateResponse: '⚠️ Weapons must be declared before kickoff.' },
    })
    return prisma.zombieChimmyAction.findUniqueOrThrow({ where: { id: log.id } })
  }

  const roster = await prisma.roster.findFirst({ where: { leagueId, platformUserId: userId } })
  if (!roster) throw new Error('Not in league')
  const team = await prisma.zombieLeagueTeam.findUnique({
    where: { leagueId_rosterId: { leagueId, rosterId: roster.id } },
    include: { items: true },
  })
  const item = team?.items.find((i) => i.itemType === weapon && !i.isUsed && !i.isExpired && i.activationState === 'ready')
  if (!item) {
    await prisma.zombieChimmyAction.update({
      where: { id: log.id },
      data: {
        isValid: false,
        privateResponse: "⚠️ You don't hold that weapon.",
      },
    })
    return prisma.zombieChimmyAction.findUniqueOrThrow({ where: { id: log.id } })
  }

  const st = team?.status.toLowerCase() ?? ''
  if (!st.includes('survivor')) {
    await prisma.zombieChimmyAction.update({
      where: { id: log.id },
      data: { isValid: false, privateResponse: '⚠️ Only Survivors can arm a defensive weapon.' },
    })
    return prisma.zombieChimmyAction.findUniqueOrThrow({ where: { id: log.id } })
  }

  const alreadyArmed = await prisma.zombieTeamItem.count({
    where: { teamStatusId: team!.id, activationState: 'pending_activation', activatesAtWeek: week, itemType: { startsWith: 'weapon_' } },
  })
  if (alreadyArmed > 0) {
    return prisma.zombieChimmyAction.update({
      where: { id: log.id },
      data: { isValid: false, validationError: 'weapon_already_armed', privateResponse: '⚠️ One defensive weapon may be armed per week.' },
    })
  }
  await prisma.zombieTeamItem.update({
    where: { id: item.id },
    data: { activationState: 'pending_activation', activatesAtWeek: week, usedEffect: 'infection_shield' },
  })
  await prisma.zombieChimmyAction.update({
    where: { id: log.id },
    data: {
      isValid: true,
      publicResponse: '⚔️ A Survivor armed a weapon against the Horde.',
      privateResponse: `Your ${weapon.replace('weapon_', '')} protects you from one Zombie or Whisperer infection in Week ${week}. It is spent only if it stops an infection.`,
      effect: { itemId: item.id, protection: 'horde_infection' },
    },
  })

  await notifyCommissioner(leagueId, 'weapon_used', 'Weapon activated', `${weapon} (week ${week})`, {
    week,
    relatedUserId: userId,
  })
  await appendZombieAudit({
    leagueId,
    zombieLeagueId: z.id,
    eventType: 'weapon_use',
    metadata: { userId, weapon, week },
  })
  await queueAnimation(leagueId, week, 'weapon_acquired', userId, { weapon })

  return prisma.zombieChimmyAction.findUniqueOrThrow({ where: { id: log.id } })
}

/** Spend a shield only when it actually stopped an infection; otherwise return it to inventory. */
export async function finalizePendingWeaponsForWeek(leagueId: string, week: number, season: number): Promise<void> {
  const matchups = await getNativeMatchupOutcomes(leagueId, week, season)
  if (!matchups) return
  const pending = await prisma.zombieTeamItem.findMany({
    where: { team: { leagueId }, activationState: 'pending_activation', activatesAtWeek: week, usedEffect: 'infection_shield' },
    include: { team: true },
  })
  for (const item of pending) {
    const matchup = matchups.find((m) => m.loserRosterId === item.team.rosterId)
    const winner = matchup ? await prisma.zombieLeagueTeam.findUnique({
      where: { leagueId_rosterId: { leagueId, rosterId: matchup.winnerRosterId } },
      select: { status: true },
    }) : null
    const protectedInfection =
      matchup && item.team.status === 'Survivor' && (winner?.status === 'Zombie' || winner?.status === 'Whisperer')
    await prisma.zombieTeamItem.update({
      where: { id: item.id },
      data: protectedInfection
        ? { isUsed: true, usedAtWeek: week, activationState: 'ready' }
        : { activationState: 'ready', activatesAtWeek: null, usedEffect: null },
    })
    if (protectedInfection) {
      await queueAnimation(leagueId, week, 'weapon_acquired', item.userId, { shieldedInfection: true, weapon: item.itemType }).catch(() => {})
    }
  }
}

export async function processBombAction(
  leagueId: string,
  userId: string,
  rawMessage: string,
  week: number,
): Promise<{ id: string }> {
  const z = await prisma.zombieLeague.findUnique({ where: { leagueId } })
  if (!z) throw new Error('Zombie league not found')

  const log = await prisma.zombieChimmyAction.create({
    data: {
      leagueId,
      userId,
      week,
      actionType: 'bomb_use',
      rawMessage,
    },
  })

  const roster = await prisma.roster.findFirst({ where: { leagueId, platformUserId: userId } })
  if (!roster) throw new Error('Not in league')
  const team = await prisma.zombieLeagueTeam.findUnique({
    where: { leagueId_rosterId: { leagueId, rosterId: roster.id } },
    include: { items: true },
  })
  const bomb = team?.items.find((i) => i.itemType === 'weapon_bomb' && !i.isUsed)
  const st = team?.status.toLowerCase() ?? ''
  if (!bomb || st.includes('zombie')) {
    await prisma.zombieChimmyAction.update({
      where: { id: log.id },
      data: {
        isValid: false,
        privateResponse: '⚠️ Bomb unavailable or invalid role.',
      },
    })
    return prisma.zombieChimmyAction.findUniqueOrThrow({ where: { id: log.id } })
  }

  await prisma.zombieChimmyAction.update({
    where: { id: log.id },
    data: {
      isValid: true,
      publicResponse: '💣 A bomb has been armed. Detonation imminent.',
      requiresCommissionerApproval: true,
    },
  })

  await notifyCommissioner(leagueId, 'bomb_used', '💣 BOMB ARMED', `Player ${userId} armed a bomb (week ${week}).`, {
    urgency: 'critical',
    requiresAction: true,
    actionDeadline: new Date(Date.now() + 3600 * 1000),
    week,
    relatedUserId: userId,
  })

  await prisma.zombieTeamItem.update({
    where: { id: bomb.id },
    data: { isUsed: true, usedAtWeek: week },
  })

  await queueAnimation(leagueId, week, 'bomb_detonated', userId, { bomb: true }, undefined, undefined, 6000)

  return prisma.zombieChimmyAction.findUniqueOrThrow({ where: { id: log.id } })
}
