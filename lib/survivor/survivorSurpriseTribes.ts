import 'server-only'

/**
 * SURPRISE TWO-TRIBE WEEKS after the merge.
 *
 * The commissioner chooses how many (0–3) at creation; nobody, the commissioner included, learns
 * which weeks until each one arrives. Once the merge happens the weeks are drawn at random from
 * the remaining post-merge elimination weeks (never the last two, which crown the finalists) and
 * sealed in a Chimmy-authored action row that no screen reads back. At the top of a sealed week
 * the remaining cast is split at random into two equal temporary tribes; with an odd cast one
 * manager sits the split out and is safe for the week. That week scores by tribe: the higher tribe
 * is safe, its necklace goes unawarded, and the lower tribe alone attends Tribal Council. At the
 * week flip the tribes dissolve and everyone is one tribe again.
 *
 * Mechanically the week borrows the pre-merge plumbing: `SurvivorPlayer.tribeId` points at the
 * temporary tribe so the weekly score rows carry it, the immunity resolver sees two tribes, and
 * the council opens with scope `surprise`, which the council service treats as "attending tribe
 * only". The merged tribe row and the merge chat are untouched throughout.
 */

import { randomInt } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

import { normalizeSurvivorFoundationSettings } from './normalizeSurvivorSettings'
import { withSurvivorSetupTransaction } from './survivorSetupTransaction'
import { createSurvivorChatMessage } from './survivorChatBridge'
import type { SurvivorFullSeasonPlan } from './survivorFullSeasonPlan'
import { SURVIVOR_HOST_USER_ID } from './survivorTribeRedrawActions'

export const SURPRISE_TRIBE_SWAP_TYPE = 'surprise_two_tribes'
export const SURPRISE_TRIBE_WEEKS_ACTION = 'surprise_tribe_weeks_sealed'
/** Fewer managers than this and a two-tribe council is a coin flip; the week runs as a normal merge week. */
export const SURPRISE_TRIBE_MIN_CAST = 6
const SURPRISE_TRIBE_NAMES = ['Ember', 'Tide'] as const
const SURPRISE_TRIBE_COLORS = ['#f97316', '#0ea5e9'] as const

// ---------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------

/** Post-merge elimination weeks the surprise can land on: after `afterWeek`, never the last two. */
export function surpriseWeekCandidates(plan: Pick<SurvivorFullSeasonPlan, 'eliminationWeeks'>, afterWeek: number): number[] {
  // Distinct weeks: a double-elimination week is listed twice in the plan but is one candidate.
  const sorted = [...new Set(plan.eliminationWeeks)].sort((a, b) => a - b)
  const protectedTail = new Set(sorted.slice(-2))
  return sorted.filter((week) => week > afterWeek && !protectedTail.has(week))
}

/** Draw `count` distinct weeks. `pick(n)` returns an integer in [0, n). */
export function chooseSurpriseWeeks(candidates: readonly number[], count: number, pick: (n: number) => number = (n) => randomInt(n)): number[] {
  const pool = [...new Set(candidates)].sort((a, b) => a - b)
  const chosen: number[] = []
  while (chosen.length < Math.max(0, Math.trunc(count)) && pool.length) {
    const [week] = pool.splice(pick(pool.length), 1)
    if (week !== undefined) chosen.push(week)
  }
  return chosen.sort((a, b) => a - b)
}

export interface SurpriseSplit {
  tribes: [string[], string[]]
  /** With an odd cast, the manager who sits the split out and is safe this week. */
  benched: string | null
}

/** Split managers into two equal tribes at random; an odd cast benches one manager. */
export function splitIntoTwoTribes(userIds: readonly string[], pick: (n: number) => number = (n) => randomInt(n)): SurpriseSplit {
  const pool = [...new Set(userIds)].sort()
  const shuffled: string[] = []
  while (pool.length) {
    const [next] = pool.splice(pick(pool.length), 1)
    if (next !== undefined) shuffled.push(next)
  }
  const benched = shuffled.length % 2 === 1 ? shuffled.pop() ?? null : null
  const half = shuffled.length / 2
  return { tribes: [shuffled.slice(0, half).sort(), shuffled.slice(half).sort()], benched }
}

// ---------------------------------------------------------------------------------------------
// DB layer
// ---------------------------------------------------------------------------------------------

function sealedActionId(leagueId: string): string {
  return `survivor-surprise-weeks:${leagueId}`
}

function readWeeks(state: Prisma.JsonValue | null | undefined): number[] {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return []
  const weeks = (state as Record<string, unknown>).weeks
  return Array.isArray(weeks) ? weeks.filter((week): week is number => Number.isInteger(week)) : []
}

/** The sealed weeks, or null when the merge has not sealed any yet. */
export async function getSealedSurpriseTribeWeeks(leagueId: string): Promise<number[] | null> {
  const row = await prisma.survivorCommissionerAction.findUnique({ where: { id: sealedActionId(leagueId) }, select: { newState: true } })
  return row ? readWeeks(row.newState) : null
}

/**
 * Seal the weeks once, after the merge. Idempotent: an existing row is returned as-is, so a
 * commissioner changing the setting mid-season does not redraw weeks already sealed.
 */
export async function sealSurpriseTribeWeeks(
  leagueId: string,
  input: { plan: Pick<SurvivorFullSeasonPlan, 'eliminationWeeks'>; afterWeek: number; count: number; pick?: (n: number) => number },
): Promise<number[]> {
  const existing = await getSealedSurpriseTribeWeeks(leagueId)
  if (existing) return existing
  const weeks = chooseSurpriseWeeks(surpriseWeekCandidates(input.plan, input.afterWeek), input.count, input.pick)
  await prisma.survivorCommissionerAction.create({ data: {
    id: sealedActionId(leagueId), leagueId, commissionerId: SURVIVOR_HOST_USER_ID, week: input.afterWeek,
    actionType: SURPRISE_TRIBE_WEEKS_ACTION,
    description: 'Surprise two-tribe weeks after the merge, drawn by Chimmy and sealed until each one arrives.',
    newState: { weeks, count: input.count }, wasConfirmed: true,
  } })
  await prisma.survivorAuditEntry.create({ data: {
    leagueId, week: input.afterWeek, category: 'tribe', action: 'surprise_tribe_weeks_sealed',
    data: { count: weeks.length }, isVisibleToCommissioner: true, isVisibleToPublic: true,
  } })
  return weeks
}

export interface ActiveSurpriseTribeWeek {
  week: number
  tribeIds: string[]
  benchedUserId: string | null
}

/** The surprise split in force for `week`, while its temporary tribes are still active. */
export async function getActiveSurpriseTribeWeek(leagueId: string, week: number): Promise<ActiveSurpriseTribeWeek | null> {
  const swap = await prisma.survivorTribeSwap.findFirst({
    where: { leagueId, week, swapType: SURPRISE_TRIBE_SWAP_TYPE },
    orderBy: { executedAt: 'desc' },
    select: { newTribes: true },
  })
  if (!swap) return null
  const after = readSurpriseMeta(swap.newTribes)
  if (!after) return null
  const live = await prisma.survivorTribe.findMany({ where: { id: { in: after.tribeIds }, leagueId, isActive: true }, select: { id: true } })
  if (live.length !== after.tribeIds.length) return null
  return { week, tribeIds: after.tribeIds, benchedUserId: after.benchedUserId }
}

/**
 * Kept in the swap row's `newTribes` column; `beforeSnapshot` / `afterSnapshot` keep the
 * `[{ tribeId, rosterIds }]` shape every other swap reader (the shuffle view, the season story)
 * expects, so a surprise week never confuses them.
 */
type SurpriseMeta = { tribeIds: string[]; benchedUserId: string | null; mergedTribeId: string | null; previous: Array<{ userId: string; tribeId: string | null }> }

function readSurpriseMeta(value: Prisma.JsonValue | null | undefined): SurpriseMeta | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const tribeIds = Array.isArray(raw.tribeIds) ? raw.tribeIds.filter((id): id is string => typeof id === 'string') : []
  if (tribeIds.length !== 2) return null
  const previous = Array.isArray(raw.previous)
    ? raw.previous.filter((row): row is { userId: string; tribeId: string | null } => Boolean(row) && typeof row === 'object' && typeof (row as Record<string, unknown>).userId === 'string')
    : []
  return {
    tribeIds,
    benchedUserId: typeof raw.benchedUserId === 'string' ? raw.benchedUserId : null,
    mergedTribeId: typeof raw.mergedTribeId === 'string' ? raw.mergedTribeId : null,
    previous: previous.map((row) => ({ userId: row.userId, tribeId: typeof row.tribeId === 'string' ? row.tribeId : null })),
  }
}

export type EnsureSurpriseOutcome =
  | { drawn: false; reason: 'disabled' | 'not_merged' | 'not_sealed_week' | 'already_drawn' | 'cast_too_small' | 'no_config' }
  | { drawn: true; tribeIds: string[]; benchedUserId: string | null }

/**
 * Called by the season runner at the top of each elimination week. Seals the weeks on the first
 * post-merge call, and on a sealed week draws the two tribes once. Everything else is a no-op.
 */
export async function ensureSurpriseTribeWeek(
  leagueId: string,
  week: number,
  plan: Pick<SurvivorFullSeasonPlan, 'eliminationWeeks'>,
  opts: { pick?: (n: number) => number } = {},
): Promise<EnsureSurpriseOutcome> {
  const [league, game] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } }),
    prisma.survivorGameState.findUnique({ where: { leagueId }, select: { phase: true, mergeTriggeredAt: true } }),
  ])
  const settings = normalizeSurvivorFoundationSettings(league?.settings && typeof league.settings === 'object' ? (league.settings as Record<string, unknown>) : {})
  if (settings.postMergeSurpriseTribeWeeks < 1) return { drawn: false, reason: 'disabled' }
  const merged = Boolean(game?.mergeTriggeredAt) || ['merge', 'post_merge'].includes(game?.phase ?? '')
  if (!merged) return { drawn: false, reason: 'not_merged' }
  const weeks = await sealSurpriseTribeWeeks(leagueId, { plan, afterWeek: week, count: settings.postMergeSurpriseTribeWeeks, pick: opts.pick })
  if (!weeks.includes(week)) return { drawn: false, reason: 'not_sealed_week' }
  if (await getActiveSurpriseTribeWeek(leagueId, week)) return { drawn: false, reason: 'already_drawn' }
  const alreadyDrawn = await prisma.survivorTribeSwap.findFirst({ where: { leagueId, week, swapType: SURPRISE_TRIBE_SWAP_TYPE }, select: { id: true } })
  if (alreadyDrawn) return { drawn: false, reason: 'already_drawn' }

  return withSurvivorSetupTransaction(leagueId, async (db): Promise<EnsureSurpriseOutcome> => {
    const config = await db.survivorLeagueConfig.findUnique({ where: { leagueId }, select: { id: true } })
    if (!config) return { drawn: false, reason: 'no_config' }
    const active = await db.survivorPlayer.findMany({
      where: { leagueId, playerState: 'active' },
      select: { id: true, userId: true, displayName: true, tribeId: true, redraftRosterId: true },
      orderBy: { displayName: 'asc' },
    })
    if (active.length < SURPRISE_TRIBE_MIN_CAST) return { drawn: false, reason: 'cast_too_small' }
    const split = splitIntoTwoTribes(active.map((player) => player.userId), opts.pick)
    const merged = await db.survivorTribe.findFirst({ where: { leagueId, isMerged: true }, orderBy: { createdAt: 'desc' }, select: { id: true } })
    const byUser = new Map(active.map((player) => [player.userId, player]))
    const tribeIds: string[] = []
    for (let index = 0; index < 2; index += 1) {
      const tribe = await db.survivorTribe.create({ data: {
        leagueId, configId: config.id, name: SURPRISE_TRIBE_NAMES[index], slotIndex: 1000 + week * 2 + index,
        colorHex: SURPRISE_TRIBE_COLORS[index], isActive: true, isMerged: false, phase: 'surprise',
      }, select: { id: true } })
      tribeIds.push(tribe.id)
      for (const userId of split.tribes[index]) {
        const player = byUser.get(userId)!
        if (player.redraftRosterId) await db.survivorTribeMember.create({ data: { tribeId: tribe.id, rosterId: player.redraftRosterId, isLeader: false } })
        await db.survivorPlayer.update({ where: { id: player.id }, data: { tribeId: tribe.id } })
      }
    }
    const rosterIdsOf = (userIds: string[]) => userIds.map((userId) => byUser.get(userId)?.redraftRosterId).filter((id): id is string => Boolean(id))
    await db.survivorTribeSwap.create({ data: {
      leagueId, week, swapType: SURPRISE_TRIBE_SWAP_TYPE,
      beforeSnapshot: [{ tribeId: merged?.id ?? null, rosterIds: rosterIdsOf(active.map((player) => player.userId)) }] as unknown as Prisma.InputJsonValue,
      afterSnapshot: [
        { tribeId: tribeIds[0], rosterIds: rosterIdsOf(split.tribes[0]) },
        { tribeId: tribeIds[1], rosterIds: rosterIdsOf(split.tribes[1]) },
      ] as unknown as Prisma.InputJsonValue,
      newTribes: {
        tribeIds, benchedUserId: split.benched, mergedTribeId: merged?.id ?? null,
        previous: active.map((player) => ({ userId: player.userId, tribeId: player.tribeId })),
      } as unknown as Prisma.InputJsonValue,
      originalTribesRetained: true,
    } })
    const names = (userIds: string[]) => userIds.map((userId) => byUser.get(userId)?.displayName ?? userId).join(', ')
    const channel = await db.survivorChatChannel.findFirst({ where: { leagueId, channelType: 'merge', isArchived: false }, select: { id: true } })
    if (channel) {
      await createSurvivorChatMessage(db, { data: { leagueId, channelId: channel.id, channelType: 'merge',
        senderUserId: 'survivor-host-chimmy', senderName: 'Chimmy', senderIsHost: true, isSystemMessage: true, contentType: 'host_announcement',
        content: `Surprise. For week ${week} only, the island splits in two. ${SURPRISE_TRIBE_NAMES[0]}: ${names(split.tribes[0])}. ${SURPRISE_TRIBE_NAMES[1]}: ${names(split.tribes[1])}.${split.benched ? ` ${byUser.get(split.benched)?.displayName ?? split.benched} sits this one out and is safe.` : ''} The higher-scoring tribe is safe; the other goes to Tribal Council. Next week you are one tribe again.` } })
    }
    await db.survivorAuditEntry.create({ data: {
      leagueId, week, category: 'tribe', action: 'surprise_tribes_drawn',
      data: { tribeIds, sizes: [split.tribes[0].length, split.tribes[1].length], benchedUserId: split.benched },
      isVisibleToCommissioner: true, isVisibleToPublic: true,
    } })
    return { drawn: true, tribeIds, benchedUserId: split.benched }
  })
}

/** At the week flip: everyone back onto the merged tribe, the temporary tribes retired. */
export async function dissolveSurpriseTribes(leagueId: string, week: number): Promise<{ dissolved: boolean }> {
  const swap = await prisma.survivorTribeSwap.findFirst({
    where: { leagueId, week, swapType: SURPRISE_TRIBE_SWAP_TYPE },
    orderBy: { executedAt: 'desc' },
    select: { id: true, newTribes: true },
  })
  const after = swap ? readSurpriseMeta(swap.newTribes) : null
  if (!swap || !after) return { dissolved: false }
  const live = await prisma.survivorTribe.findMany({ where: { id: { in: after.tribeIds }, leagueId, isActive: true }, select: { id: true } })
  if (!live.length) return { dissolved: false }
  await withSurvivorSetupTransaction(leagueId, async (db) => {
    const restoreTo = after.mergedTribeId
    for (const row of after.previous) {
      await db.survivorPlayer.updateMany({
        where: { leagueId, userId: row.userId, tribeId: { in: after.tribeIds } },
        data: { tribeId: restoreTo ?? row.tribeId },
      })
    }
    await db.survivorTribeMember.deleteMany({ where: { tribeId: { in: after.tribeIds } } })
    await db.survivorTribe.updateMany({ where: { id: { in: after.tribeIds } }, data: { isActive: false } })
    const channel = await db.survivorChatChannel.findFirst({ where: { leagueId, channelType: 'merge', isArchived: false }, select: { id: true } })
    if (channel) {
      await createSurvivorChatMessage(db, { data: { leagueId, channelId: channel.id, channelType: 'merge',
        senderUserId: 'survivor-host-chimmy', senderName: 'Chimmy', senderIsHost: true, isSystemMessage: true, contentType: 'host_announcement',
        content: `The surprise tribes are gone. Week ${week} is behind you and the island is one tribe again.` } })
    }
    await db.survivorAuditEntry.create({ data: {
      leagueId, week, category: 'tribe', action: 'surprise_tribes_dissolved',
      data: { tribeIds: after.tribeIds }, isVisibleToCommissioner: true, isVisibleToPublic: true,
    } })
  })
  return { dissolved: true }
}
