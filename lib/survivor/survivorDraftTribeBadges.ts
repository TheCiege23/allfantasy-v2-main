import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { SlotOrderEntry, SlotOrderTribeBadge } from '@/lib/live-draft-engine/types'
import { readStoredTribePlan } from './survivorTribePlan'
import { resolveTribeEmblem } from './survivorTribeIdentity'

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
