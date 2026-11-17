import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { SlotOrderEntry, SlotOrderTribeBadge } from '@/lib/live-draft-engine/types'
import { readStoredTribePlan } from './survivorTribePlan'
import { resolveTribeEmblem } from './survivorTribeIdentity'
import { readSGTribes } from '@/lib/survivor-guillotine/live'
import { sgTribeArt } from '@/lib/survivor-guillotine/visual-model'

type Db = Prisma.TransactionClient | typeof prisma

/**
 * Survivor tribes exist before the draft (the commissioner locks the plan, which writes
 * SurvivorTribe + SurvivorTribeMember keyed by Roster id). This stamps each draft seat with its
 * tribe so the room can show it — the plan's `showOnBoard` toggle hides it when the commissioner
 * wants the reveal to wait. Non-Survivor leagues pay one indexed read and are returned untouched.
 */
export async function attachSurvivorTribeBadges(leagueId: string, slotOrder: SlotOrderEntry[], db: Db = prisma): Promise<SlotOrderEntry[]> {
  if (slotOrder.length === 0) return slotOrder
  const league = await db.league.findUnique({ where: { id: leagueId }, select: { survivorMode: true, leagueVariant: true } })
  if (league?.leagueVariant === 'survivor_guillotine') return attachSurvivorGuillyTribeBadges(leagueId, slotOrder, db)
  if (!league || (!league.survivorMode && league.leagueVariant !== 'survivor')) return slotOrder
  const detail = await db.league.findUnique({ where: { id: leagueId }, select: { sport: true, settings: true } })
  if (readStoredTribePlan(detail?.settings)?.showOnBoard === false) return slotOrder
  const tribes = await db.survivorTribe.findMany({
    where: { leagueId, isActive: true, isMerged: false },
    select: { id: true, name: true, colorHex: true, catalogId: true, primaryColor: true, secondaryColor: true, logoUrl: true, members: { select: { rosterId: true } } },
    orderBy: { slotIndex: 'asc' },
  })
  if (tribes.length === 0) return slotOrder
  const byRoster = new Map<string, SlotOrderTribeBadge>()
  for (const tribe of tribes) {
    const emblem = resolveTribeEmblem(tribe, detail?.sport)
    const badge: SlotOrderTribeBadge = {
      id: tribe.id, name: tribe.name, colorHex: tribe.colorHex ?? tribe.primaryColor ?? null, markUrl: emblem.markUrl, crestUrl: emblem.crestUrl,
    }
    for (const member of tribe.members) byRoster.set(member.rosterId, badge)
  }
  if (byRoster.size === 0) return slotOrder
  return slotOrder.map((entry) => {
    const tribe = byRoster.get(entry.rosterId)
    return tribe ? { ...entry, tribe } : entry
  })
}

/**
 * Survivor Guilly forms its starting tribes in period 0, and the random and manager-choice
 * formations can finish before the draft. Its engine stores ids only (`tribe-0`…); the name, colour
 * and symbol come from `sgTribeArt`, the same identity the league page shows, so the board and the
 * league never disagree on what a tribe is called. No tribes formed yet: the board is untouched.
 */
async function attachSurvivorGuillyTribeBadges(leagueId: string, slotOrder: SlotOrderEntry[], db: Db): Promise<SlotOrderEntry[]> {
  const row = await db.survivorGuillotineLeague.findUnique({ where: { leagueId }, select: { tribes: true } })
  const members = readSGTribes(row?.tribes)
  if (members.length === 0) return slotOrder
  const byRoster = new Map<string, SlotOrderTribeBadge>()
  for (const member of members) {
    const art = sgTribeArt(member.tribeId)
    byRoster.set(member.rosterId, { id: member.tribeId, name: art.name, colorHex: art.color, markUrl: art.symbolSrc, crestUrl: art.buffSrc })
  }
  return slotOrder.map((entry) => {
    const tribe = byRoster.get(entry.rosterId)
    return tribe ? { ...entry, tribe } : entry
  })
}
