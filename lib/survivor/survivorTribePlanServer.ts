import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { loadAdpBySleeperId } from '@/lib/adp/resolveAdp'
import { rosterPlayerIds } from '@/lib/leagues/rosterForTeam'
import { SURVIVOR_TRIBE_CATALOG, type SurvivorTribeSlot } from './survivorTribeIdentity'
import { assignSurvivorTribes } from './survivorTribeProvisioning'
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
 * Locking WRITES the tribes (owner's call, 2026-10-20: tribes exist before the draft, so the draft
 * room can show them). `SurvivorTribeMember.rosterId` is a Roster id, which exists as soon as a seat
 * is claimed, so the rows are written pre-draft through `assignSurvivorTribes` in its `preDraft`
 * mode; the SurvivorPlayer rows that appear after the draft are linked to them by
 * `prepareSurvivorDraftParticipants`, and `initializeSurvivorPhase2` keeps them (`alreadyAssigned`).
 * The plan itself is still frozen in league settings (`survivorTribePlan.lockedAt`).
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
      return { userId: u.id, displayName: u.displayName || u.username || 'Manager', strength: strength.get(u.id) ?? null, rosterId: r.id }
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
}

export function tribeNameForSlot(slots: readonly SurvivorTribeSlot[], slot: number): string {
  const name = SURVIVOR_TRIBE_CATALOG.find(t => t.id === slots[slot]?.catalogId)?.name
  return name ? `Tribe ${name}` : `Tribe ${slot + 1}`
}

export type LockedTribeSummary = { id: string; slotIndex: number; name: string; memberCount: number }
export type LockOutcome =
  | { ok: true; plan: StoredTribePlan; announced: boolean; tribes: LockedTribeSummary[] }
  | { ok: false; status: 409 | 422; error: string }

/**
 * Freeze the plan. Validates against the CURRENT cast and capacities (never the client's copy of
 * them), writes the tribes and their members (keyed by roster), stores the plan, and posts the
 * announcement to league chat when the plan asks for it. The tribe write comes FIRST so a refusal
 * leaves nothing behind — the caller's transaction commits whatever ran before an early return.
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
  if (args.participants.some(p => !p.rosterId)) {
    return { ok: false, status: 422, error: 'Every manager needs a claimed seat before tribes can lock.' }
  }
  const stored: StoredTribePlan = { ...args.plan, lockedAt: new Date().toISOString(), lockedBy: args.actorUserId }
  const assigned = await assignSurvivorTribes(args.leagueId, {
    db: args.db,
    mode: 'commissioner_manual',
    manualMapping: stored.mapping,
    tribeCount: capacities.length,
    participants: args.participants.map(p => ({ userId: p.userId, rosterId: p.rosterId!, displayName: p.displayName })),
    preDraft: true,
    actorUserId: args.actorUserId,
  })
  if (!assigned.ok) return { ok: false, status: 422, error: assigned.error }
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
  return { ok: true, plan: stored, announced, tribes: assigned.tribes }
}
