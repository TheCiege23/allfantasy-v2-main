/**
 * Survivor tribe creation and membership (PROMPT 346). Deterministic.
 * Supports random and commissioner-assigned formation; commissioner or auto tribe names.
 */

import { prisma } from '@/lib/prisma'
import { getSurvivorConfig } from './SurvivorLeagueConfig'
import { appendSurvivorAudit } from './SurvivorAuditLog'
import { MIN_TRIBES, MAX_TRIBES, MIN_TRIBE_SIZE, MAX_TRIBE_SIZE } from './constants'
import type { SurvivorTribeWithMembers, SurvivorTribeRow, SurvivorTribeMemberRow } from './types'

/** Seeded RNG for deterministic random assignment. */
function seededShuffle<T>(arr: T[], seed: number): T[] {
  const out = [...arr]
  let s = seed
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) >>> 0
    const j = (s % (i + 1)) >>> 0
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Create tribes after draft: random or commissioner-assigned.
 * If commissioner-assigned, rosterToTribeIndex must be provided (rosterId -> 0-based tribe index).
 * Tribe names: if provided, use; otherwise auto-generate (Tribe 1, Tribe 2, ...).
 */
export async function createTribes(
  leagueId: string,
  options: {
    rosterIds: string[]
    formation: 'random' | 'commissioner'
    rosterToTribeIndex?: Record<string, number>
    tribeNames?: string[]
    seed?: number
  }
): Promise<{ ok: boolean; tribes?: SurvivorTribeWithMembers[]; error?: string }> {
  const config = await getSurvivorConfig(leagueId)
  if (!config) return { ok: false, error: 'Not a Survivor league' }

  const existing = await prisma.survivorTribe.findMany({
    where: { configId: config.configId },
    include: { members: true },
  })
  if (existing.length > 0) return { ok: false, error: 'Tribes already exist' }

  const { tribeCount, tribeSize } = config
  if (tribeCount < MIN_TRIBES || tribeCount > MAX_TRIBES) return { ok: false, error: 'Invalid tribe count' }
  if (tribeSize < MIN_TRIBE_SIZE || tribeSize > MAX_TRIBE_SIZE) return { ok: false, error: 'Invalid tribe size' }

  const rosterIds = options.rosterIds.filter(Boolean)
  if (rosterIds.length === 0) return { ok: false, error: 'No rosters' }

  let assignment: { rosterId: string; tribeIndex: number }[]
  if (options.formation === 'commissioner' && options.rosterToTribeIndex) {
    assignment = rosterIds.map((rosterId) => ({
      rosterId,
      tribeIndex: Math.max(0, Math.min((options.rosterToTribeIndex![rosterId] ?? 0), tribeCount - 1)),
    }))
  } else {
    const seed = options.seed ?? Date.now()
    const shuffled = seededShuffle(rosterIds, seed)
    assignment = shuffled.map((rosterId, i) => ({
      rosterId,
      tribeIndex: i % tribeCount,
    }))
  }

  const tribeNames = options.tribeNames ?? Array.from({ length: tribeCount }, (_, i) => `Tribe ${i + 1}`)

  const tribes: SurvivorTribeRow[] = []
  const members: { tribeId: string; rosterId: string; isLeader: boolean }[] = []

  for (let slot = 0; slot < tribeCount; slot++) {
    const name = tribeNames[slot] ?? `Tribe ${slot + 1}`
    const tribe = await prisma.survivorTribe.create({
      data: {
        leagueId,
        configId: config.configId,
        name,
        slotIndex: slot,
      },
    })
    tribes.push({
      id: tribe.id,
      leagueId: tribe.leagueId,
      configId: tribe.configId,
      name: tribe.name,
      slotIndex: tribe.slotIndex,
    })
    const tribeRosters = assignment.filter((a) => a.tribeIndex === slot).map((a) => a.rosterId)
    const firstRoster = tribeRosters[0]
    for (const rosterId of tribeRosters) {
      await prisma.survivorTribeMember.create({
        data: {
          tribeId: tribe.id,
          rosterId,
          isLeader: rosterId === firstRoster,
        },
      })
      members.push({
        tribeId: tribe.id,
        rosterId,
        isLeader: rosterId === firstRoster,
      })
    }
  }

  await appendSurvivorAudit(leagueId, config.configId, 'tribe_created', {
    tribeCount,
    rosterCount: rosterIds.length,
    formation: options.formation,
  })

  const withMembers: SurvivorTribeWithMembers[] = tribes.map((t) => ({
    ...t,
    members: members
      .filter((m) => m.tribeId === t.id)
      .map((m) => ({ id: m.tribeId + m.rosterId, tribeId: m.tribeId, rosterId: m.rosterId, isLeader: m.isLeader })),
  }))
  return { ok: true, tribes: withMembers }
}

/**
 * Get all tribes with members for a league.
 */
export async function getTribesWithMembers(leagueId: string): Promise<SurvivorTribeWithMembers[]> {
  const config = await getSurvivorConfig(leagueId)
  if (!config) return []

  const tribes = await prisma.survivorTribe.findMany({
    where: { configId: config.configId },
    orderBy: { slotIndex: 'asc' },
    include: { members: true },
  })
  return tribes.map((t) => ({
    id: t.id,
    leagueId: t.leagueId,
    configId: t.configId,
    name: t.name,
    slotIndex: t.slotIndex,
    logoUrl: t.logoUrl,
    colorHex: t.colorHex,
    members: t.members.map((m): SurvivorTribeMemberRow => ({
      id: m.id,
      tribeId: m.tribeId,
      rosterId: m.rosterId,
      isLeader: m.isLeader,
    })),
  }))
}

/**
 * Get roster's tribe (pre-merge). Returns null if not in a tribe or post-merge.
 */
export async function getTribeForRoster(leagueId: string, rosterId: string): Promise<SurvivorTribeRow | null> {
  const config = await getSurvivorConfig(leagueId)
  if (!config) return null
  const member = await prisma.survivorTribeMember.findFirst({
    where: { rosterId },
    include: { tribe: true },
  })
  if (!member) return null
  const t = member.tribe
  return { id: t.id, leagueId: t.leagueId, configId: t.configId, name: t.name, slotIndex: t.slotIndex }
}

/**
 * Update tribe name (commissioner).
 */
export async function setTribeName(leagueId: string, tribeId: string, name: string): Promise<{ ok: boolean; error?: string }> {
  const config = await getSurvivorConfig(leagueId)
  if (!config) return { ok: false, error: 'Not a Survivor league' }
  await prisma.survivorTribe.updateMany({
    where: { id: tribeId, configId: config.configId },
    data: { name: name.slice(0, 128) },
  })
  return { ok: true }
}

/**
 * Set tribe leader (commissioner).
 */
export async function setTribeLeader(leagueId: string, tribeId: string, rosterId: string): Promise<{ ok: boolean; error?: string }> {
  const config = await getSurvivorConfig(leagueId)
  if (!config) return { ok: false, error: 'Not a Survivor league' }
  const member = await prisma.survivorTribeMember.findFirst({
    where: { tribeId, rosterId },
  })
  if (!member) return { ok: false, error: 'Roster not in tribe' }
  await prisma.survivorTribeMember.updateMany({
    where: { tribeId },
    data: { isLeader: false },
  })
  await prisma.survivorTribeMember.update({
    where: { id: member.id },
    data: { isLeader: true },
  })
  return { ok: true }
}
