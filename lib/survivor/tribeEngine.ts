/**
 * Survivor tribe assignment, rebalance, swap, merge — integrates with SurvivorTribeService (roster-based).
 */

import { prisma } from '@/lib/prisma'
import type { SurvivorTribe } from '@prisma/client'
import { createTribes } from './SurvivorTribeService'
import { appendSurvivorAudit } from './SurvivorAuditLog'
import { getSurvivorConfig } from './SurvivorLeagueConfig'
import { postHostMessage } from './hostEngine'
import { PROVISIONAL_MERGED_TRIBE_NAME } from './tribeSwapReveal'

function fisherYatesShuffle<T>(arr: T[]): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

const TRIBE_COLORS = ['#38bdf8', '#f97316', '#a78bfa', '#34d399', '#f472b6', '#fbbf24', '#94a3b8', '#ef4444']

function autoTribeNames(count: number): string[] {
  const base = ['Vaka', 'Baka', 'Luvu', 'Ua', 'Yase', 'Nuku', 'Sele', 'Dakal']
  return Array.from({ length: count }, (_, i) => base[i % base.length] + (i >= base.length ? ` ${i + 1}` : ''))
}

/**
 * Assign managers to tribes. Uses existing Survivor config + roster rows.
 * `draft_pattern`: snake draft order by roster creation order for balanced tribes.
 */
export async function assignPlayersToTribes(
  leagueId: string,
  mode: 'auto' | 'manual' | 'draft_pattern',
): Promise<SurvivorTribe[]> {
  if (mode === 'manual') {
    throw new Error('Manual tribe assignment must supply roster→tribe mapping via commissioner tools.')
  }

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      name: true,
      survivorTribeCount: true,
      survivorTribeNaming: true,
      survivorPhase: true,
    },
  })
  const config = await getSurvivorConfig(leagueId)
  if (!config) throw new Error('Survivor config missing — enable Survivor for this league first.')

  const tribeCount = league?.survivorTribeCount ?? config.tribeCount
  const rosters = await prisma.roster.findMany({
    where: { leagueId },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  const rosterIds = rosters.map((r) => r.id)
  if (rosterIds.length === 0) throw new Error('No rosters in league')

  let formation: 'random' | 'commissioner' = 'random'
  let rosterToTribeIndex: Record<string, number> | undefined

  if (mode === 'draft_pattern') {
    formation = 'commissioner'
    const n = tribeCount
    rosterToTribeIndex = {}
    let direction = 1
    let slot = 0
    for (let i = 0; i < rosterIds.length; i++) {
      const rid = rosterIds[i]!
      rosterToTribeIndex[rid] = slot
      slot += direction
      if (slot >= n || slot < 0) {
        direction *= -1
        slot += direction
      }
    }
  } else if (mode === 'auto') {
    const shuffled = fisherYatesShuffle(rosterIds)
    formation = 'commissioner'
    rosterToTribeIndex = {}
    shuffled.forEach((rid, i) => {
      rosterToTribeIndex![rid] = i % tribeCount
    })
  } else {
    formation = 'random'
  }

  const naming = league?.survivorTribeNaming ?? 'auto'
  const tribeNames = naming === 'auto' ? autoTribeNames(tribeCount) : undefined

  const created = await createTribes(leagueId, {
    rosterIds,
    formation,
    rosterToTribeIndex,
    tribeNames,
    seed: Date.now(),
  })
  if (!created.ok || !created.tribes) {
    throw new Error(created.error ?? 'Tribe assignment failed')
  }

  const tribeRows = await prisma.survivorTribe.findMany({
    where: { configId: config.configId },
    orderBy: { slotIndex: 'asc' },
  })

  for (let i = 0; i < tribeRows.length; i++) {
    const color = TRIBE_COLORS[i % TRIBE_COLORS.length]
    await prisma.survivorTribe.update({
      where: { id: tribeRows[i]!.id },
      data: { colorHex: color, phase: 'pre_merge' },
    })
  }

  await appendSurvivorAudit(leagueId, config.configId, 'tribe_created', { mode, tribeCount })

  await postHostMessage(
    leagueId,
    'welcome',
    { leagueName: league?.name ?? leagueId, week: 1 },
    'league_chat',
  ).catch(() => {})

  return prisma.survivorTribe.findMany({
    where: { leagueId },
    orderBy: { slotIndex: 'asc' },
  })
}

export async function rebalanceTribes(leagueId: string): Promise<void> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { survivorRebalanceTrigger: true },
  })
  const minSize = league?.survivorRebalanceTrigger ?? 3
  const config = await getSurvivorConfig(leagueId)
  if (!config) return

  const tribes = await prisma.survivorTribe.findMany({
    where: { configId: config.configId, isMerged: false },
    include: { members: true },
  })
  const sizes = new Map(tribes.map((t) => [t.id, [...t.members]] as const))
  const movedMemberIds: string[] = []

  // Iteratively move one member from the largest donor (size > minSize+1)
  // to the smallest recipient (size < minSize) until no undersized tribe
  // remains or no eligible donor exists. Bounded by member count to prevent
  // pathological looping on malformed data.
  const hardStop = tribes.reduce((acc, t) => acc + t.members.length, 0) + 1
  for (let i = 0; i < hardStop; i++) {
    const entries = [...sizes.entries()].map(([tribeId, members]) => ({ tribeId, members }))
    const smallest = entries
      .filter((e) => e.members.length > 0 && e.members.length < minSize)
      .sort((a, b) => a.members.length - b.members.length)[0]
    if (!smallest) break
    const donor = entries
      .filter((e) => e.tribeId !== smallest.tribeId && e.members.length > minSize + 1)
      .sort((a, b) => b.members.length - a.members.length)[0]
    if (!donor) break

    const moved = [...donor.members].pop()
    if (!moved) break
    await prisma.survivorTribeMember.update({
      where: { id: moved.id },
      data: { tribeId: smallest.tribeId },
    })
    sizes.set(donor.tribeId, donor.members)
    sizes.set(smallest.tribeId, [...smallest.members, moved])
    movedMemberIds.push(moved.id)
  }

  await appendSurvivorAudit(leagueId, config.configId, 'tribe_shuffle', {
    minSize,
    moved: movedMemberIds.length,
  })
}

/**
 * Tribe swap (phase change or commissioner). The draw is made on the server with a crypto RNG and
 * SEALED: memberships, chats and idols do not change until the reveal at the next lineup lock
 * (lib/survivor/tribeSwapService.revealDueTribeSwap). Returns the swap id.
 */
export async function executeTribeSwap(
  leagueId: string,
  week: number,
  swapType: string,
): Promise<{ id: string }> {
  const { sealTribeSwap } = await import('./tribeSwapService')
  const sealed = await sealTribeSwap(leagueId, week, swapType)
  const config = await getSurvivorConfig(leagueId)
  if (config) await appendSurvivorAudit(leagueId, config.configId, 'tribe_shuffle', { swapId: sealed.id, swapType, sealedUntil: sealed.revealAt.toISOString() })
  return { id: sealed.id }
}

export async function executeMerge(leagueId: string, week: number): Promise<void> {
  await prisma.league.update({
    where: { id: leagueId },
    data: { survivorPhase: 'merge' },
  })
  const config = await getSurvivorConfig(leagueId)
  if (!config) return

  // Named later by the commissioner or a manager vote (tribeSwapService.nameMergedTribe).
  const mergedName = PROVISIONAL_MERGED_TRIBE_NAME
  const tribe = await prisma.survivorTribe.create({
    data: {
      leagueId,
      configId: config.configId,
      name: mergedName,
      slotIndex: 99,
      isMerged: true,
      phase: 'merged',
    },
  })

  const members = await prisma.survivorTribeMember.findMany({
    where: { tribe: { configId: config.configId } },
  })
  for (const m of members) {
    await prisma.survivorTribeMember.update({
      where: { id: m.id },
      data: { tribeId: tribe.id },
    })
  }

  await prisma.survivorTribe.updateMany({
    where: { configId: config.configId, id: { not: tribe.id } },
    data: { isActive: false, phase: 'dissolved' },
  })

  await appendSurvivorAudit(leagueId, config.configId, 'merge', { week, mergedTribeId: tribe.id })
  await postHostMessage(leagueId, 'merge_announcement', { leagueName: mergedName, week }, 'merge_chat').catch(
    () => {},
  )
}
