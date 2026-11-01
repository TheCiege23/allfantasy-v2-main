import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { parseZombieSettlementSnapshot } from './weeklySettlementSnapshot'
import { itemTransaction, lockItemLeague, usesBeta2025Items } from './beta2025ItemService'
import { planBetaItemSettlement, WEAPON_LABELS, type ItemWeekMatchup } from './beta2025Items'

type Tx = Prisma.TransactionClient
export async function reviveBetaTeamInTransaction(tx: Tx, teamId: string, week: number): Promise<boolean> {
  const team = await tx.zombieLeagueTeam.findUnique({ where: { id: teamId }, include: { items: true } })
  if (!team || team.status !== 'Zombie' || team.weekBecameZombie === week || team.killedAtWeek === week) return false
  const serums = team.items.filter(i => i.itemType.includes('serum') && !i.isUsed && !i.isExpired && i.activationState === 'ready').sort((a, b) => a.id.localeCompare(b.id)).slice(0, 2)
  if (serums.length < 2) return false
  const spent = await tx.zombieTeamItem.updateMany({ where: { id: { in: serums.map(i => i.id) }, teamStatusId: team.id, isUsed: false, isExpired: false }, data: { isUsed: true, usedAtWeek: week, usedEffect: 'beta2025_revive' } })
  if (spent.count !== 2) throw new Error('ZOMBIE_ITEMS_REVIVE_BALANCE_CHANGED')
  const changed = await tx.zombieLeagueTeam.updateMany({ where: { id: team.id, status: 'Zombie' }, data: { status: 'Survivor', revivedAt: new Date(), weekBecameZombie: null, killedByRosterId: null, isWhisperer: false } })
  if (changed.count !== 1) throw new Error('ZOMBIE_ITEMS_REVIVE_ROLE_CHANGED')
  await tx.zombieAuditLog.create({ data: { leagueId: team.leagueId, zombieLeagueId: team.zombieLeagueId, eventType: 'revive', metadata: { policy: 'beta_2025', rosterId: team.rosterId, week, itemIds: serums.map(i => i.id) } } })
  return true
}
export async function reviveBetaZombie(leagueId: string, userId: string, week: number): Promise<boolean> {
  return itemTransaction(async tx => {
    await lockItemLeague(tx, leagueId)
    const z = await tx.zombieLeague.findUnique({ where: { leagueId } })
    if (!z || !usesBeta2025Items(z) || z.currentWeek !== week || !['active', 'in_progress'].includes(z.status)) return false
    const roster = await tx.roster.findFirst({ where: { leagueId, platformUserId: userId } })
    const team = roster && await tx.zombieLeagueTeam.findUnique({ where: { leagueId_rosterId: { leagueId, rosterId: roster.id } } })
    return team ? reviveBetaTeamInTransaction(tx, team.id, week) : false
  })
}
export async function autoReviveBetaZombies(leagueId: string, week: number): Promise<number> {
  return itemTransaction(async tx => {
    await lockItemLeague(tx, leagueId)
    const z = await tx.zombieLeague.findUnique({ where: { leagueId } })
    if (!z || !usesBeta2025Items(z) || z.currentWeek !== week || !['active', 'in_progress'].includes(z.status)) return 0
    const resolution = await tx.zombieWeeklyResolution.findUnique({ where: { zombieLeagueId_week: { zombieLeagueId: z.id, week } } })
    if (resolution && resolution.status !== 'pending') return 0
    const teams = await tx.zombieLeagueTeam.findMany({ where: { leagueId, status: 'Zombie' }, select: { id: true } })
    let revived = 0
    for (const team of teams) if (await reviveBetaTeamInTransaction(tx, team.id, week)) revived++
    return revived
  })
}
/** Atomic, sealed item loot + awards + revival. The receipt is committed with the inventory changes. */
export async function settleBetaItems(zombieLeagueId: string, week: number) {
  return itemTransaction(async tx => {
    const z = await tx.zombieLeague.findUnique({ where: { id: zombieLeagueId } })
    if (!z || !usesBeta2025Items(z)) return null
    await lockItemLeague(tx, z.leagueId)
    const resolution = await tx.zombieWeeklyResolution.findUnique({ where: { zombieLeagueId_week: { zombieLeagueId, week } } })
    const snapshot = parseZombieSettlementSnapshot(resolution?.settlementSnapshot)
    if (snapshot?.itemsPolicy !== 'beta_2025' || !snapshot.itemMatchups || !snapshot.winnings) throw new Error('ZOMBIE_ITEMS_MISSING_SNAPSHOT')
    const previous = resolution?.itemEvents as { policy?: string; complete?: boolean } | null
    if (previous?.policy === 'beta_2025' && previous.complete) return previous
    const plan = planBetaItemSettlement({ week, matchups: snapshot.itemMatchups, teams: snapshot.teams, items: snapshot.items,
      openingByRoster: snapshot.winnings.openingByRoster, ...snapshot.rules,
      weaponsEnabled: snapshot.itemWeaponsEnabled === true, highScoreEnabled: snapshot.config?.serumAwardHighScore !== false,
      combatSerumsEnabled: snapshot.config?.serumAwardOnBashMaul !== false })
    for (const transfer of plan.transfers) {
      const from = snapshot.teams.find(t => t.rosterId === transfer.fromRosterId)!
      const to = snapshot.teams.find(t => t.rosterId === transfer.toRosterId)!
      const owner = snapshot.owners.find(o => o.rosterId === to.rosterId)?.userId
      if (!owner) throw new Error('ZOMBIE_ITEMS_MISSING_OWNER')
      const moved = await tx.zombieTeamItem.updateMany({ where: { id: transfer.itemId, teamStatusId: from.id, isUsed: false, isExpired: false }, data: { teamStatusId: to.id, userId: owner, acquiredReason: `loot_week_${week}`, activationState: 'ready', activatesAtWeek: week + 1 } })
      if (moved.count !== 1) throw new Error('ZOMBIE_ITEMS_LOOT_CHANGED')
    }
    for (const award of plan.awards) {
      const team = snapshot.teams.find(t => t.rosterId === award.rosterId)!
      const owner = snapshot.owners.find(o => o.rosterId === team.rosterId)?.userId
      if (!owner) throw new Error('ZOMBIE_ITEMS_MISSING_OWNER')
      const awardKey = `item2025:${z.id}:${week}:${award.reason}:${team.rosterId}`
      await tx.zombieTeamItem.upsert({ where: { awardKey }, create: { awardKey, teamStatusId: team.id, zombieLeagueId: z.id, userId: owner, itemType: award.itemType, itemLabel: WEAPON_LABELS[award.itemType] ?? '🧪 Serum', acquiredAtWeek: week, acquiredReason: award.reason, activatesAtWeek: week + 1 }, update: {} })
    }
    const revivedRosterIds: string[] = []
    for (const team of snapshot.teams) if (await reviveBetaTeamInTransaction(tx, team.id, week)) revivedRosterIds.push(team.rosterId)
    const receipt = { policy: 'beta_2025', complete: true, ...plan, revivedRosterIds }
    await tx.zombieWeeklyResolution.update({ where: { zombieLeagueId_week: { zombieLeagueId, week } }, data: { itemEvents: toPrismaJsonInput(receipt), serumAwards: toPrismaJsonInput(plan.awards.filter(a => a.itemType === 'serum')), weaponAwards: toPrismaJsonInput(plan.awards.filter(a => a.itemType.startsWith('weapon_'))) } })
    return receipt
  })
}

export function readBetaItemMatchup(input: { matchupId: string; homeRosterId: string; awayRosterId: string; homeScore: number; awayScore: number; lineupSnapshots: unknown }): ItemWeekMatchup {
  const scoring = (input.lineupSnapshots as { zombieItems?: { policy?: string; homeBaseScore?: number; awayBaseScore?: number; home?: { bonus?: number; weaponBonus?: number }; away?: { bonus?: number; weaponBonus?: number } } } | null)?.zombieItems
  if (scoring?.policy !== 'beta_2025' || [scoring.homeBaseScore, scoring.awayBaseScore, scoring.home?.bonus, scoring.away?.bonus, scoring.home?.weaponBonus, scoring.away?.weaponBonus].some(n => typeof n !== 'number' || !Number.isFinite(n))) throw new Error('ZOMBIE_ITEMS_MISSING_SCORE_RECEIPT')
  if (Math.abs(input.homeScore - scoring.homeBaseScore! - scoring.home!.bonus!) > 0.005 || Math.abs(input.awayScore - scoring.awayBaseScore! - scoring.away!.bonus!) > 0.005) throw new Error('ZOMBIE_ITEMS_SCORE_RECEIPT_MISMATCH')
  return { matchupId: input.matchupId, homeRosterId: input.homeRosterId, awayRosterId: input.awayRosterId, homeScore: input.homeScore, awayScore: input.awayScore, homeBaseScore: scoring.homeBaseScore!, awayBaseScore: scoring.awayBaseScore!, homeWeaponBonus: scoring.home!.weaponBonus!, awayWeaponBonus: scoring.away!.weaponBonus! }
}
