import 'server-only'

import { withSurvivorSetupTransaction } from './survivorSetupTransaction'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  computeTribeAssignment,
  defaultTribeColor,
  defaultTribeName,
  type AssignmentParticipant,
  type TribeAssignmentMode,
} from './survivorTribeAssignmentEngine'

export interface SurvivorTribeProvisioningOptions {
  mode?: TribeAssignmentMode
  tribeCount?: number
  seed?: number | null
  manualMapping?: Record<string, number> | null
  draftOrder?: string[] | null
  /** Per-slot overrides: { [slotIndex]: { name?, colorHex?, logoUrl? } }. Preserved on rebalance. */
  tribeMeta?: Record<number, { name?: string; colorHex?: string; logoUrl?: string }> | null
  /** Allow re-assignment over an already-locked set (reset path). */
  allowReassign?: boolean
  actorUserId?: string
  db?: Prisma.TransactionClient
}

export type SurvivorTribeAssignmentOutcome =
  | {
      ok: true
      created: boolean
      alreadyAssigned: boolean
      tribes: Array<{ id: string; slotIndex: number; name: string; memberCount: number }>
      seed: number | null
    }
  | { ok: false; status: 400 | 409 | 422; code: string; error: string }

/** Ensure a SurvivorLeagueConfig row exists (tribes require configId). */
async function ensureConfig(leagueId: string, tribeCount: number, db: Prisma.TransactionClient): Promise<{ id: string }> {
  const existing = await db.survivorLeagueConfig.findUnique({ where: { leagueId }, select: { id: true } })
  if (existing) return existing
  return db.survivorLeagueConfig.create({
    data: { leagueId, tribeCount, tribeSize: 5, tribeFormation: 'random' },
    select: { id: true },
  })
}

/** Active participants eligible for tribe assignment (excludes eliminated/exile/jury/host). */
async function loadActiveParticipants(leagueId: string, db: Prisma.TransactionClient): Promise<AssignmentParticipant[]> {
  const players = await db.survivorPlayer.findMany({
    where: { leagueId, playerState: 'active' },
    select: { userId: true, displayName: true, redraftRosterId: true },
    orderBy: { displayName: 'asc' },
  })
  return (players as Array<{ userId: string; displayName: string; redraftRosterId: string | null }>).map((p) => ({
    userId: p.userId,
    rosterId: p.redraftRosterId ?? p.userId,
    displayName: p.displayName,
  }))
}

export async function getTribeAssignmentStatus(
  leagueId: string,
  db: Prisma.TransactionClient = prisma,
): Promise<{ assigned: boolean; tribeCount: number; memberCount: number }> {
  const tribes = await db.survivorTribe.findMany({
    where: { leagueId },
    select: { id: true, members: { select: { id: true } } },
  })
  const memberCount = (tribes as Array<{ members: unknown[] }>).reduce((n, t) => n + t.members.length, 0)
  return { assigned: tribes.length > 0 && memberCount > 0, tribeCount: tribes.length, memberCount }
}

export async function assignSurvivorTribes(
  leagueId: string,
  opts: SurvivorTribeProvisioningOptions,
): Promise<SurvivorTribeAssignmentOutcome> {
  if (!opts.db) return withSurvivorSetupTransaction(leagueId, (db) => assignSurvivorTribes(leagueId, { ...opts, db }))
  const db = opts.db
  const status = await getTribeAssignmentStatus(leagueId, db)
  if (status.assigned && !opts.allowReassign) {
    const tribes = await db.survivorTribe.findMany({
      where: { leagueId },
      select: { id: true, slotIndex: true, name: true, members: { select: { id: true } } },
      orderBy: { slotIndex: 'asc' },
    })
    return {
      ok: true,
      created: false,
      alreadyAssigned: true,
      tribes: (tribes as Array<{ id: string; slotIndex: number; name: string; members: unknown[] }>).map((t) => ({
        id: t.id,
        slotIndex: t.slotIndex,
        name: t.name,
        memberCount: t.members.length,
      })),
      seed: null,
    }
  }

  const tribeCount = Math.max(2, Math.floor(opts.tribeCount ?? 4))
  const participants = await loadActiveParticipants(leagueId, db)
  const assignment = computeTribeAssignment({
    participants,
    tribeCount,
    mode: opts.mode ?? 'random',
    seed: opts.seed ?? null,
    manualMapping: opts.manualMapping ?? null,
    draftOrder: opts.draftOrder ?? null,
  })
  if (!assignment.ok) {
    const httpStatus: 400 | 422 = assignment.code === 'limited_data' ? 422 : 400
    return { ok: false, status: httpStatus, code: assignment.code, error: assignment.error }
  }

  const config = await ensureConfig(leagueId, tribeCount, db)
  const rosterByUser = new Map(participants.map((p) => [p.userId, p.rosterId]))
  type ExistingTribeMeta = { slotIndex: number; name: string; colorHex: string | null; logoUrl: string | null }
  const existingBySlot = new Map<number, ExistingTribeMeta>(
    ((await db.survivorTribe.findMany({
      where: { leagueId },
      select: { slotIndex: true, name: true, colorHex: true, logoUrl: true },
    })) as ExistingTribeMeta[]).map((t) => [t.slotIndex, t] as [number, ExistingTribeMeta]),
  )

  const createdTribes: Array<{ id: string; slotIndex: number; name: string; memberCount: number }> = []

  const write = async (tx: Prisma.TransactionClient) => {
    if (opts.allowReassign && status.assigned) {
      const oldTribeIds = ((await tx.survivorTribe.findMany({ where: { leagueId }, select: { id: true } })) as Array<{ id: string }>).map((t) => t.id)
      if (oldTribeIds.length) await tx.survivorTribeMember.deleteMany({ where: { tribeId: { in: oldTribeIds } } })
      await tx.survivorPlayer.updateMany({ where: { leagueId }, data: { tribeId: null } })
      await tx.survivorTribe.deleteMany({ where: { leagueId } })
    }

    for (const tribe of assignment.tribes) {
      const slot = tribe.slotIndex
      const meta = opts.tribeMeta?.[slot]
      const preserved = existingBySlot.get(slot)
      const name = meta?.name ?? preserved?.name ?? defaultTribeName(slot)
      const colorHex = meta?.colorHex ?? preserved?.colorHex ?? defaultTribeColor(slot)
      const logoUrl = meta?.logoUrl ?? preserved?.logoUrl ?? null

      const row = await tx.survivorTribe.create({
        data: { leagueId, configId: config.id, name, slotIndex: slot, colorHex, logoUrl, isActive: true, phase: 'pre_merge' },
        select: { id: true },
      })

      for (const userId of tribe.memberUserIds) {
        const rosterId = rosterByUser.get(userId) ?? userId
        await tx.survivorTribeMember.create({ data: { tribeId: row.id, rosterId } })
        await tx.survivorPlayer.update({
          where: { leagueId_userId: { leagueId, userId } },
          data: { tribeId: row.id, canAccessTribeChat: true },
        })
      }
      createdTribes.push({ id: row.id, slotIndex: slot, name, memberCount: tribe.memberUserIds.length })
    }

    await tx.survivorAuditEntry.create({
      data: {
        leagueId,
        category: 'tribe',
        action: opts.allowReassign && status.assigned ? 'tribes_reassigned' : 'tribes_assigned',
        actorUserId: opts.actorUserId ?? null,
        data: {
          mode: assignment.mode,
          seed: assignment.seed,
          tribeCount,
          participantCount: participants.length,
          sizes: assignment.tribes.map((t) => t.memberUserIds.length),
        },
        isVisibleToCommissioner: true,
        isVisibleToPublic: true,
      },
    })

    await tx.survivorGameState.upsert({
      where: { leagueId },
      create: {
        leagueId,
        phase: 'pre_merge',
        activeTribeCount: tribeCount,
        activePlayerCount: participants.length,
        preMergeStartedAt: new Date(),
      },
      update: { activeTribeCount: tribeCount, activePlayerCount: participants.length },
    })
  }
  await write(db)

  return { ok: true, created: true, alreadyAssigned: false, tribes: createdTribes, seed: assignment.seed }
}
