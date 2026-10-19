import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { loadAdpBySleeperId } from '@/lib/adp/resolveAdp'
import { rosterPlayerIds } from '@/lib/leagues/rosterForTeam'
import { SURVIVOR_TRIBE_CATALOG, type SurvivorTribeSlot } from './survivorTribeIdentity'
import {
  readLockedTribePlanMapping,
  readStoredTribePlan,
  strengthsFromAdp,
  tribeAnnouncementText,
  validateTribePlan,
  type PlanParticipant,
  type StoredTribePlan,
  type SurvivorTribePlan,
} from './survivorTribePlan'

/**
 * Server half of the pre-draft tribe plan (handoff §5.4). Reads only Postgres:
 *   - the cast = this league's claimed rosters (Roster.platformUserId → AppUser), the SAME identity
 *     `prepareSurvivorDraftParticipants` turns into SurvivorPlayer rows after the draft, so a locked
 *     plan's userIds are exactly the userIds the post-draft assignment sees;
 *   - AF strength = DB-first ADP (`loadAdpBySleeperId`, the adp_data table) of each roster's players.
 *     No provider call. No rostered players with ADP → null, and Balanced by AF says so.
 *
 * Locking does NOT write tribes. It freezes the plan in league settings (`survivorTribePlan.lockedAt`)
 * and `initializeSurvivorPhase2` assigns from it after the draft — before the draft there are no
 * SurvivorPlayer roster links for SurvivorTribeMember rows to point at.
 */

export { readStoredTribePlan, readLockedTribePlanMapping, type StoredTribePlan }

export async function loadTribePlanParticipants(
  leagueId: string,
  opts: { sport: string; excludeUserId?: string | null; db?: Prisma.TransactionClient | typeof prisma },
): Promise<PlanParticipant[]> {
  const db = opts.db ?? prisma
  const rosters = await db.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true, playerData: true } })
  const users = await db.appUser.findMany({
    where: { id: { in: rosters.map(r => r.platformUserId) } },
    select: { id: true, displayName: true, username: true },
  })
  const userById = new Map(users.map(u => [u.id, u]))
  const cast = rosters.filter(r => userById.has(r.platformUserId) && r.platformUserId !== opts.excludeUserId)

  const idsByUser = new Map<string, string[]>()
  for (const r of cast) idsByUser.set(r.platformUserId, rosterPlayerIds(r.playerData) ?? [])
  const allIds = [...new Set([...idsByUser.values()].flat())]
  const adp = allIds.length
    ? await loadAdpBySleeperId({ prisma: db as never, sport: opts.sport, sleeperIds: allIds }).catch(() => new Map())
    : new Map()
  const adpsByUser = new Map<string, number[]>()
  for (const [userId, ids] of idsByUser) {
    adpsByUser.set(userId, ids.map(id => adp.get(id)?.adp).filter((a): a is number => typeof a === 'number'))
  }
  const strength = strengthsFromAdp(adpsByUser)
  return cast
    .map(r => {
      const u = userById.get(r.platformUserId)!
      return { userId: u.id, displayName: u.displayName || u.username || 'Manager', strength: strength.get(u.id) ?? null }
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
}

export function tribeNameForSlot(slots: readonly SurvivorTribeSlot[], slot: number): string {
  const name = SURVIVOR_TRIBE_CATALOG.find(t => t.id === slots[slot]?.catalogId)?.name
  return name ? `Tribe ${name}` : `Tribe ${slot + 1}`
}

export type LockOutcome = { ok: true; plan: StoredTribePlan; announced: boolean } | { ok: false; status: 409 | 422; error: string }

/**
 * Freeze the plan. Validates against the CURRENT cast and capacities (never the client's copy of
 * them), stores it, and posts the announcement to league chat when the plan asks for it.
 */
export async function lockSurvivorTribePlan(args: {
  db: Prisma.TransactionClient
  leagueId: string
  actorUserId: string
  plan: SurvivorTribePlan
  participants: PlanParticipant[]
  managers: number
  slots: SurvivorTribeSlot[]
  settingsSnapshot: Record<string, unknown>
  postAnnouncement: (text: string) => Promise<unknown>
}): Promise<LockOutcome> {
  if (args.participants.length !== args.managers) {
    return { ok: false, status: 422, error: `${args.participants.length} of ${args.managers} seats are claimed. Tribes lock once every seat has a manager.` }
  }
  const capacities = args.slots.map(s => s.managerCount)
  const invalid = validateTribePlan(args.plan.mapping, args.participants, capacities)
  if (invalid) return { ok: false, status: 422, error: invalid }
  const stored: StoredTribePlan = { ...args.plan, lockedAt: new Date().toISOString(), lockedBy: args.actorUserId }
  await args.db.league.update({
    where: { id: args.leagueId },
    data: { settings: { ...args.settingsSnapshot, survivorTribePlan: stored } as Prisma.InputJsonValue },
  })
  await args.db.survivorAuditEntry.create({ data: {
    leagueId: args.leagueId, actorUserId: args.actorUserId, category: 'tribe', action: 'tribe_plan_locked',
    data: { mode: stored.mode, seed: stored.seed, sizes: capacities }, isVisibleToPublic: true, isVisibleToCommissioner: true,
  } })
  let announced = false
  if (stored.announceInChat) {
    const tribes = capacities.map((_, slot) => ({
      name: tribeNameForSlot(args.slots, slot),
      members: args.participants.filter(p => stored.mapping[p.userId] === slot).map(p => p.displayName),
    }))
    // Best-effort: a failed post must not undo the lock.
    announced = await args.postAnnouncement(tribeAnnouncementText(tribes)).then(() => true, () => false)
  }
  return { ok: true, plan: stored, announced }
}
