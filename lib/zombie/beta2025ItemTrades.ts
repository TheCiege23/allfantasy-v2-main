import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { itemRole, WEAPON_POINTS } from './beta2025Items'
import { lastStarterDeadline, loadBetaItemScoreReceipt, lockItemLeague } from './beta2025ItemService'

type Asset = { assetType: string; fromRosterId: string; toRosterId: string; metadata?: unknown }
type Tx = Prisma.TransactionClient
export function zombieItemId(asset: Asset): string {
  const id = (asset.metadata as { zombieItemId?: unknown } | null)?.zombieItemId
  if (typeof id !== 'string' || !id || id.length > 160) throw new Error('Zombie item assets require an inventory item id.')
  return id
}
export async function validateBetaTradeItems(db: Tx, leagueId: string, rosterIds: string[], assets: readonly Asset[]) {
  if (rosterIds.length !== 2) throw new Error('Zombie item trades currently support two teams.')
  const z = await db.zombieLeague.findUnique({ where: { leagueId } })
  if (!z || z.sport.toUpperCase() !== 'NFL' || !['active', 'in_progress'].includes(z.status)) throw new Error('Item trades require an active 2025 NFL Zombie league.')
  const resolution = await db.zombieWeeklyResolution.findUnique({ where: { zombieLeagueId_week: { zombieLeagueId: z.id, week: z.currentWeek } } })
  if (resolution && resolution.status !== 'pending') throw new Error('Item trades are held while the week resolves or awaits review.')
  const rosters = await db.redraftRoster.findMany({ where: { id: { in: rosterIds }, leagueId, season: { season: z.season } }, select: { id: true, ownerId: true } })
  if (rosters.length !== 2) throw new Error('Both managers need current native rosters.')
  const owners = await db.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true, redraftRosterId: true } })
  const teams = await db.zombieLeagueTeam.findMany({ where: { leagueId }, include: { items: true } })
  const teamFor = (id: string) => {
    const owner = rosters.find(r => r.id === id)?.ownerId
    const roster = owners.find(r => r.redraftRosterId === id) ?? owners.find(r => r.platformUserId === owner)
    const team = teams.find(t => t.rosterId === roster?.id)
    if (!team || itemRole(team.status) === 'Zombie') throw new Error('Zombies cannot trade. Survivors and Whisperers may trade items.')
    return team
  }
  rosterIds.forEach(teamFor)
  const seen = new Set<string>()
  for (const asset of assets) {
    const id = zombieItemId(asset)
    if (seen.has(id)) throw new Error('An item cannot appear twice in a trade.')
    seen.add(id)
    if (!rosterIds.includes(asset.fromRosterId) || !rosterIds.includes(asset.toRosterId) || asset.fromRosterId === asset.toRosterId) throw new Error('Invalid item trade direction.')
    const team = teamFor(asset.fromRosterId)
    const item = team.items.find(i => i.id === id)
    if (!item || item.isUsed || item.isExpired || item.activationState !== 'ready' || (!item.itemType.includes('serum') && !WEAPON_POINTS[item.itemType])) throw new Error('A traded item is spent, unavailable or no longer owned by its sender.')
    if (z.experienceMode === 'simple' && WEAPON_POINTS[item.itemType]) throw new Error('Weapons are off in Simple Zombie.')
  }
  return { z, rosters, teamFor }
}
/** Called by the native trade settlement, inside its player/FAAB transaction. */
export async function settleBetaTradeItems(tx: Tx, input: { leagueId: string; rosterIds: string[]; assets: readonly Asset[]; tradeId: string }) {
  await lockItemLeague(tx, input.leagueId)
  // Infection changes the same team rows; lock them before checking current role permissions.
  await tx.$queryRaw`SELECT id FROM zombie_league_teams WHERE "leagueId" = ${input.leagueId} ORDER BY id FOR UPDATE`
  const { z, rosters, teamFor } = await validateBetaTradeItems(tx, input.leagueId, input.rosterIds, input.assets)
  const matchups = await tx.redraftMatchup.findMany({ where: { leagueId: input.leagueId, week: z.currentWeek, awayRosterId: { not: null } } })
  const nextWeekByRoster = new Map<string, boolean>()
  for (const m of matchups) {
    if (![m.homeRosterId, m.awayRosterId].some(id => id && input.rosterIds.includes(id))) continue
    const receipt = await loadBetaItemScoreReceipt({ leagueId: z.leagueId, week: z.currentWeek, season: z.season, homeRosterId: m.homeRosterId, awayRosterId: m.awayRosterId!, previousSnapshots: m.lineupSnapshots }, tx)
    if (!receipt) throw new Error('Item score receipt is unavailable.')
    const old = m.lineupSnapshots && typeof m.lineupSnapshots === 'object' && !Array.isArray(m.lineupSnapshots) ? m.lineupSnapshots : {}
    await tx.redraftMatchup.update({ where: { id: m.id }, data: { lineupSnapshots: toPrismaJsonInput({ ...old, zombieItems: { ...((old as { zombieItems?: object }).zombieItems ?? {}), ...receipt } }) } })
  }
  for (const roster of rosters) {
    const deadline = await lastStarterDeadline(tx, roster.id, z.season, z.currentWeek)
    nextWeekByRoster.set(roster.id, !deadline || deadline.getTime() <= Date.now())
  }
  const movedItems: Array<{ id: string; fromTeamId: string; toTeamId: string; itemType: string }> = []
  for (const asset of input.assets) {
    const from = teamFor(asset.fromRosterId), to = teamFor(asset.toRosterId)
    const item = from.items.find(i => i.id === zombieItemId(asset))!
    const owner = rosters.find(r => r.id === asset.toRosterId)!.ownerId
    const moved = await tx.zombieTeamItem.updateMany({ where: { id: item.id, teamStatusId: from.id, isUsed: false, isExpired: false, activationState: 'ready' }, data: { teamStatusId: to.id, userId: owner, acquiredReason: `trade:${input.tradeId}`, activatesAtWeek: Math.max(item.activatesAtWeek ?? 0, z.currentWeek + (nextWeekByRoster.get(asset.toRosterId) ? 1 : 0)) } })
    if (moved.count !== 1) throw new Error('Item ownership changed during the trade.')
    movedItems.push({ id: item.id, fromTeamId: from.id, toTeamId: to.id, itemType: item.itemType })
  }
  await tx.zombieAuditLog.create({ data: { leagueId: z.leagueId, zombieLeagueId: z.id, eventType: 'item_trade', metadata: toPrismaJsonInput({ tradeId: input.tradeId, week: z.currentWeek, items: movedItems }) } })
  const league = await tx.league.findUnique({ where: { id: z.leagueId }, select: { userId: true } })
  if (!league) throw new Error('League owner is unavailable for the item trade announcement.')
  await tx.leagueChatMessage.upsert({ where: { id: `zombie-item-trade:${input.tradeId}` }, create: { id: `zombie-item-trade:${input.tradeId}`, leagueId: z.leagueId, userId: league.userId, type: 'host_announcement', message: `Item trade completed: ${movedItems.map(i => i.itemType.replace('weapon_', '').replaceAll('_', ' ')).join(', ')}. Review the deal in Trade center. Items received after your last starter begins activate next week.`, metadata: { senderIsHost: true, zombieItemTrade: true, tradeId: input.tradeId } }, update: {} })
  return movedItems
}
