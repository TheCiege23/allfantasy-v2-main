import 'server-only'
import { normalizeSurvivorFoundationSettings } from './survivorSettings'
import { isTribeHex, readTribeSlots, tribeCatalogIdFor, tribeCrestUrl, SURVIVOR_TRIBE_CATALOG } from './survivorTribeIdentity'

import { withSurvivorSetupTransaction } from './survivorSetupTransaction'
import { readSurvivorGovernanceSettings } from './survivorGovernanceSettings'
import { loadCastawayExperienceFlags } from './survivorExperienceService'

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
  /**
   * The cast to assign instead of the league's active SurvivorPlayer rows. Used by the pre-draft
   * tribe lock, when the cast is the claimed rosters (userId + Roster id) and no SurvivorPlayer
   * rows exist yet. Membership is keyed by roster id, so a seat that changes hands keeps its tribe.
   */
  participants?: AssignmentParticipant[]
  /** Pre-draft lock: write tribes and members only; the game state stays `pre_draft`. */
  preDraft?: boolean
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
async function ensureConfig(leagueId: string, tribeCount: number, tribeSize: number, db: Prisma.TransactionClient): Promise<{ id: string }> {
  const existing = await db.survivorLeagueConfig.findUnique({ where: { leagueId }, select: { id: true } })
  if (existing) return existing
  return db.survivorLeagueConfig.create({
    data: { leagueId, tribeCount, tribeSize, tribeFormation: 'random' },
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

/** The tribe/cast counts the game state carries from assignment on; `pre_merge` starts here. */
async function syncTribeGameState(tx: Prisma.TransactionClient, leagueId: string, tribeCount: number, participantCount: number): Promise<void> {
  await tx.survivorGameState.upsert({
    where: { leagueId },
    create: {
      leagueId,
      phase: 'pre_merge',
      activeTribeCount: tribeCount,
      activePlayerCount: participantCount,
      preMergeStartedAt: new Date(),
    },
    update: { activeTribeCount: tribeCount, activePlayerCount: participantCount },
  })
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
    const rows = tribes as Array<{ id: string; slotIndex: number; name: string; members: unknown[] }>
    // Tribes written before the draft (the locked plan) reach here on the post-draft run: the
    // counts the create path would have stamped still need to land on the game state.
    if (!opts.preDraft) await syncTribeGameState(db, leagueId, rows.length, rows.reduce((n, t) => n + t.members.length, 0))
    return {
      ok: true,
      created: false,
      alreadyAssigned: true,
      tribes: rows.map((t) => ({
        id: t.id,
        slotIndex: t.slotIndex,
        name: t.name,
        memberCount: t.members.length,
      })),
      seed: null,
    }
  }

  const league = await db.league.findUnique({ where: { id: leagueId }, select: { settings: true, sport: true } })
  const snapshot = (league?.settings ?? {}) as Record<string, unknown>
  const settings = normalizeSurvivorFoundationSettings(snapshot)
  const tribeCount = Math.max(2, Math.floor(opts.tribeCount ?? settings.tribeCount))
  const slots = readTribeSlots(snapshot, settings.defaultTeamCount, tribeCount)
  // Legacy leagues without explicit slot choices retain balanced assignments.
  const configured = snapshot.survivorTribeSlots != null || (snapshot.survivorFoundationSettings as Record<string, unknown> | undefined)?.survivorTribeSlots != null
  const participants = opts.participants ?? await loadActiveParticipants(leagueId, db)
  // Rooks vs Vets (lib/survivor/survivorGovernanceSettings.ts): a random draw that splits new and
  // returning castaways into separate tribes. Only the random formation splits.
  const governance = readSurvivorGovernanceSettings(snapshot)
  const experience = (opts.mode ?? 'random') === 'random' && governance.tribeSplit === 'rooks_vs_vets'
    ? await loadCastawayExperienceFlags(leagueId, participants.map((p) => p.userId), governance.experienceOverrides, db)
    : null
  const assignment = computeTribeAssignment({
    experience,
    participants,
    tribeCount,
    capacities: configured ? slots.map(slot => slot.managerCount) : null,
    mode: opts.mode ?? 'random',
    seed: opts.seed ?? null,
    manualMapping: opts.manualMapping ?? null,
    draftOrder: opts.draftOrder ?? null,
  })
  if (!assignment.ok) {
    const httpStatus: 400 | 422 = assignment.code === 'limited_data' ? 422 : 400
    return { ok: false, status: httpStatus, code: assignment.code, error: assignment.error }
  }

  const config = await ensureConfig(leagueId, tribeCount, Math.max(...slots.map(slot => slot.managerCount)), db)
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
      const slotChoice = slots[slot]
      const identity = SURVIVOR_TRIBE_CATALOG.find(tribe => tribe.id === slotChoice?.catalogId)
      const name = meta?.name ?? preserved?.name ?? identity?.name ?? defaultTribeName(slot)
      const primaryColor = identity && isTribeHex(slotChoice?.primaryColor) ? slotChoice.primaryColor.toLowerCase() : null
      const secondaryColor = identity && isTribeHex(slotChoice?.secondaryColor) ? slotChoice.secondaryColor.toLowerCase() : null
      const colorHex = meta?.colorHex ?? primaryColor ?? preserved?.colorHex ?? identity?.primary ?? defaultTribeColor(slot)
      // Catalogue tribes are composed at render time from catalogId + current name/colours; logoUrl
      // keeps a composed URL for older readers. A custom (non-catalogue) logo is never overwritten.
      const preservedCustomLogo = preserved?.logoUrl && !tribeCatalogIdFor({ logoUrl: preserved.logoUrl }) && !preserved.logoUrl.startsWith('/api/survivor/tribe-emblem/') ? preserved.logoUrl : null
      const logoUrl = meta?.logoUrl ?? preservedCustomLogo ?? (identity ? tribeCrestUrl(identity.id, String(league?.sport ?? 'NFL'), { name, primaryColor, secondaryColor }) : preserved?.logoUrl ?? null)

      const row = await tx.survivorTribe.create({
        data: {
          leagueId, configId: config.id, name, slotIndex: slot, colorHex, logoUrl, isActive: true, phase: 'pre_merge',
          catalogId: identity?.id ?? null, primaryColor, secondaryColor,
        },
        select: { id: true },
      })

      for (const userId of tribe.memberUserIds) {
        const rosterId = rosterByUser.get(userId) ?? userId
        await tx.survivorTribeMember.create({ data: { tribeId: row.id, rosterId } })
        // updateMany: before the draft there is no SurvivorPlayer row to link yet; the post-draft
        // cast reconciliation links it from the member rows (survivorDraftParticipants.ts).
        await tx.survivorPlayer.updateMany({
          where: { leagueId, userId },
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
          preDraft: Boolean(opts.preDraft),
        },
        isVisibleToCommissioner: true,
        isVisibleToPublic: true,
      },
    })

    if (!opts.preDraft) await syncTribeGameState(tx, leagueId, tribeCount, participants.length)
  }
  await write(db)

  return { ok: true, created: true, alreadyAssigned: false, tribes: createdTribes, seed: assignment.seed }
}
