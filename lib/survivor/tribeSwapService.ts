import 'server-only'

import { randomInt } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import catalog from './tribeCatalog.json'
import { getActiveRosterIdsForLeague } from './SurvivorRosterState'
import { getSurvivorConfig } from './SurvivorLeagueConfig'
import { getNextLineupLock } from './sportScheduleEngine'
import { withSurvivorSetupTransaction } from './survivorSetupTransaction'
import { provisionSurvivorChats } from './survivorTribeChatProvisioning'
import { tribeCrestUrl } from './survivorTribeIdentity'
import { readSurvivorLateSeasonSettings, type SurvivorMergeNamingMode } from './lateSeasonSettings'
import { buffColorsForTribe } from './buffSvg'
import {
  PROVISIONAL_MERGED_TRIBE_NAME,
  drawSwapAssignment,
  isSwapDue,
  isSwapSealed,
  mergeNameSuggestions,
  readTribeSnapshot,
  swapViewForClient,
  tallyMergeNameVotes,
  type TribeSnapshot,
} from './tribeSwapReveal'
import { createSurvivorChatMessage } from './survivorChatBridge'
import { isNewTribeKey, planTribeSwap } from './survivorSwapPlanner'
import { swapAnnouncementCopy } from './survivorGovernanceCopy'
import type { SurvivorScheduledSwap } from './survivorGovernanceSettings'
import { readSurvivorGovernanceSettings } from './survivorGovernanceSettings'
import { castawayNameWithTribeEmoji, tribeEmojiFor } from './survivorTribeEmoji'

const HOST = { senderUserId: 'survivor-host-chimmy', senderName: 'Chimmy', senderIsHost: true, isSystemMessage: true, contentType: 'host_announcement' } as const

async function postLeagueAnnouncement(db: Prisma.TransactionClient | typeof prisma, leagueId: string, content: string) {
  const channel = await db.survivorChatChannel.findFirst({ where: { leagueId, channelType: 'league', isArchived: false }, select: { id: true } })
  if (channel) await createSurvivorChatMessage(db, { data: { leagueId, channelId: channel.id, channelType: 'league', ...HOST, content } })
}

/** What a planned swap recorded about its shape (`SurvivorTribeSwap.newTribes`). Legacy rows: nothing. */
function readSwapShape(value: unknown): { planned: boolean; retire: string[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { planned: false, retire: [] }
  const r = value as Record<string, unknown>
  return { planned: true, retire: Array.isArray(r.retire) ? r.retire.filter((id): id is string => typeof id === 'string') : [] }
}

/** Create the tribes a swap adds, named from catalogue entries this league has not used. */
async function createSwapTribes(db: Prisma.TransactionClient, leagueId: string, keys: string[]): Promise<Map<string, string>> {
  const config = await db.survivorLeagueConfig.findUnique({ where: { leagueId }, select: { id: true } })
  if (!config) throw new Error('No Survivor config')
  const [existing, league] = await Promise.all([
    db.survivorTribe.findMany({ where: { leagueId }, select: { name: true, slotIndex: true, catalogId: true } }),
    db.league.findUnique({ where: { id: leagueId }, select: { sport: true } }),
  ])
  const usedNames = new Set(existing.map((t) => t.name.trim().toLowerCase()))
  const usedIds = new Set(existing.map((t) => t.catalogId).filter(Boolean))
  // Slot 99 is the merged tribe; new swap tribes take the next free slot below it.
  let slot = Math.max(-1, ...existing.map((t) => t.slotIndex).filter((n) => n < 99)) + 1
  const out = new Map<string, string>()
  for (const key of keys) {
    const entry = catalog.find((c) => !usedIds.has(c.id) && !usedNames.has(c.name.toLowerCase()))
    if (entry) { usedIds.add(entry.id); usedNames.add(entry.name.toLowerCase()) }
    const name = entry?.name ?? `Tribe ${slot + 1}`
    const row = await db.survivorTribe.create({
      data: { leagueId, configId: config.id, name, slotIndex: slot, colorHex: entry?.primary ?? null, isActive: true, phase: 'pre_merge',
        catalogId: entry?.id ?? null, logoUrl: entry ? tribeCrestUrl(entry.id, String(league?.sport ?? 'NFL')) : null },
      select: { id: true },
    })
    out.set(key, row.id)
    slot++
  }
  return out
}

/** Everyone the scheduled swap modes can move: season points per tribe-member roster id. */
async function seasonPointsByRoster(leagueId: string): Promise<Map<string, number>> {
  const [players, scores] = await Promise.all([
    prisma.survivorPlayer.findMany({ where: { leagueId }, select: { userId: true, redraftRosterId: true } }),
    prisma.survivorWeeklyScore.findMany({ where: { leagueId }, select: { userId: true, finalScore: true } }),
  ])
  const byUser = new Map<string, number>()
  for (const s of scores) byUser.set(s.userId, (byUser.get(s.userId) ?? 0) + (s.finalScore ?? 0))
  const out = new Map<string, number>()
  for (const p of players) if (p.redraftRosterId) out.set(p.redraftRosterId, byUser.get(p.userId) ?? 0)
  return out
}

/** The tribes as first formed: the oldest swap's "before", else null (no swap has run yet). */
async function originalTribeSnapshot(leagueId: string): Promise<TribeSnapshot[] | null> {
  const first = await prisma.survivorTribeSwap.findFirst({ where: { leagueId }, orderBy: { executedAt: 'asc' }, select: { beforeSnapshot: true } })
  const snapshot = first ? readTribeSnapshot(first.beforeSnapshot) : []
  return snapshot.length ? snapshot : null
}

export interface SealTribeSwapOptions {
  /** A scheduled or commissioner swap of any kind. Omitted: the original random redraw. */
  swap?: Pick<SurvivorScheduledSwap, 'mode' | 'tribeCount' | 'pattern' | 'order'>
  actorUserId?: string | null
}

/**
 * Draw the swap and SEAL it. Memberships, tribe chats and idols are untouched until the reveal at
 * the next lineup lock. Idempotent: an existing sealed swap is returned as-is.
 *
 * With `opts.swap` the draw follows the commissioner's swap type (lib/survivor/survivorSwapPlanner):
 * more or fewer tribes, back to the original tribes, or a custom pattern. Tribes it adds are created
 * and tribes it folds are retired at the reveal, so the sealed draw shows nothing early.
 */
export async function sealTribeSwap(leagueId: string, week: number, swapType = 'random_shuffle', now = new Date(), opts: SealTribeSwapOptions = {}): Promise<{ id: string; revealAt: Date }> {
  const existing = await prisma.survivorTribeSwap.findFirst({ where: { leagueId, revealAt: { not: null }, revealedAt: null }, orderBy: { executedAt: 'desc' }, select: { id: true, revealAt: true } })
  if (existing?.revealAt) return { id: existing.id, revealAt: existing.revealAt }
  const config = await getSurvivorConfig(leagueId)
  if (!config) throw new Error('No Survivor config')
  const [league, tribes, activeRosterIds] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true } }),
    prisma.survivorTribe.findMany({ where: { configId: config.configId, isActive: true, isMerged: false }, orderBy: { slotIndex: 'asc' }, include: { members: true } }),
    getActiveRosterIdsForLeague(leagueId),
  ])
  const planned = opts.swap && opts.swap.mode !== 'random_shuffle' ? opts.swap : null
  if (tribes.length < (planned ? 1 : 2)) throw new Error('A swap needs at least two active tribes.')
  const active = new Set(activeRosterIds)
  const before: TribeSnapshot[] = tribes.map((t) => ({ tribeId: t.id, rosterIds: t.members.map((m) => m.rosterId).filter((id) => active.has(id)) }))
  let after: TribeSnapshot[]
  let plan: { retire: string[]; created: number } | null = null
  if (planned) {
    const result = planTribeSwap({
      before,
      swap: planned,
      original: planned.mode === 'return_to_original' ? (await originalTribeSnapshot(leagueId)) ?? before : null,
      seasonPoints: planned.mode === 'custom_pattern' && planned.order !== 'random' ? await seasonPointsByRoster(leagueId) : undefined,
      randomIndex: (n) => randomInt(0, n),
    })
    if (!result.ok) throw new Error(result.error)
    after = result.after
    plan = { retire: result.retire, created: result.created }
  } else {
    after = drawSwapAssignment(before, (n) => randomInt(0, n))
  }
  const type = planned ? planned.mode : swapType
  const revealAt = getNextLineupLock(league?.sport ?? 'NFL', now)
  const swap = await prisma.survivorTribeSwap.create({
    data: {
      leagueId, week, swapType: type, beforeSnapshot: before as unknown as Prisma.InputJsonValue, afterSnapshot: after as unknown as Prisma.InputJsonValue, revealAt,
      ...(plan ? { newTribes: { retire: plan.retire, created: plan.created, mode: type, tribeCount: after.length } as Prisma.InputJsonValue, originalTribesRetained: plan.retire.length === 0 && plan.created === 0 } : {}),
    },
    select: { id: true },
  })
  // The audit carries no assignment: the draw stays sealed even from audit readers. The tribe COUNT
  // is announced with the swap ("three new tribes"), so a planned swap records it.
  await prisma.survivorAuditEntry.create({ data: { leagueId, week, category: 'tribe', action: 'tribe_swap_sealed', ...(opts.actorUserId ? { actorUserId: opts.actorUserId } : {}), data: { swapId: swap.id, swapType: type, revealAt: revealAt.toISOString(), ...(plan ? { tribeCount: after.length } : {}) }, isVisibleToCommissioner: true, isVisibleToPublic: true } })
  const announcement = planned ? await swapAnnouncement(leagueId, 'sealed', type, after.length) : 'Drop your buffs. The tribes have been redrawn, and the new tribes stay sealed until the next lineup lock.'
  await postLeagueAnnouncement(prisma, leagueId, announcement).catch(() => {})
  // survivor-core §5 "Tribe swap": 24h before the reveal (now, if the reveal is closer). No assignment in it.
  const dayBefore = new Date(revealAt.getTime() - 24 * 60 * 60 * 1000)
  await import('./notificationEngine')
    .then(({ enqueueSurvivorCoreNotification }) => enqueueSurvivorCoreNotification(leagueId, { kind: 'tribe_swap' }, { role: 'active' }, dayBefore > now ? dayBefore : undefined))
    .catch(() => {})
  return { id: swap.id, revealAt }
}

async function swapAnnouncement(leagueId: string, stage: 'sealed' | 'revealed', mode: string, tribeCount: number): Promise<string> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { language: true } }).catch(() => null)
  return swapAnnouncementCopy(league?.language ?? null, stage, mode, tribeCount)
}

/**
 * Apply and reveal a sealed swap once its reveal time has passed (or now, when `force`). Moves
 * tribe memberships, switches tribe chats over, and stamps revealedAt. Idols and Exile tokens are
 * bound to the manager, so nothing about them changes.
 */
export async function revealDueTribeSwap(leagueId: string, opts: { now?: Date; force?: boolean; actorUserId?: string } = {}): Promise<{ revealed: boolean; swapId?: string }> {
  const now = opts.now ?? new Date()
  const pending = await prisma.survivorTribeSwap.findFirst({ where: { leagueId, revealAt: { not: null }, revealedAt: null }, orderBy: { executedAt: 'desc' } })
  if (!pending || (!opts.force && !isSwapDue(pending, now))) return { revealed: false }
  return withSurvivorSetupTransaction(leagueId, async (db) => {
    const swap = await db.survivorTribeSwap.findUnique({ where: { id: pending.id } })
    if (!swap || swap.revealedAt) return { revealed: false }
    const drawn = readTribeSnapshot(swap.afterSnapshot)
    const shape = readSwapShape(swap.newTribes)
    // A swap that adds tribes names them `new:<n>`; they are created now, at the reveal.
    const created = new Map<string, string>()
    if (drawn.some((t) => isNewTribeKey(t.tribeId))) {
      for (const [key, id] of await createSwapTribes(db, leagueId, drawn.filter((t) => isNewTribeKey(t.tribeId)).map((t) => t.tribeId))) created.set(key, id)
    }
    const after = drawn.map((t) => ({ tribeId: created.get(t.tribeId) ?? t.tribeId, rosterIds: t.rosterIds })).filter((t) => !isNewTribeKey(t.tribeId))
    const tribeIds = after.map((t) => t.tribeId)
    const retired = shape.retire.filter((id) => !tribeIds.includes(id))
    const [tribes, players, activeRosterIds] = await Promise.all([
      db.survivorTribe.findMany({ where: { id: { in: [...tribeIds, ...retired] } }, include: { members: true } }),
      db.survivorPlayer.findMany({ where: { leagueId, playerState: 'active' }, select: { userId: true, redraftRosterId: true } }),
      getActiveRosterIdsForLeague(leagueId),
    ])
    const active = new Set(activeRosterIds)
    // Anyone active who was not in the draw (e.g. back from Exile since) keeps their current tribe.
    const target = new Map<string, string>()
    for (const tribe of tribes) for (const m of tribe.members) if (active.has(m.rosterId)) target.set(m.rosterId, tribe.id)
    for (const tribe of after) for (const id of tribe.rosterIds) if (active.has(id)) target.set(id, tribe.tribeId)
    // Someone left in a tribe this swap folds (back from Exile since the draw) joins the smallest new tribe.
    if (retired.length) {
      const size = (id: string) => [...target.values()].filter((t) => t === id).length
      for (const [rosterId, tribeId] of target) {
        if (!retired.includes(tribeId)) continue
        const smallest = [...tribeIds].sort((a, b) => size(a) - size(b) || a.localeCompare(b))[0]
        if (smallest) target.set(rosterId, smallest)
      }
    }
    const touched = [...tribeIds, ...retired]

    const oldChannels = await db.survivorChatChannel.findMany({ where: { leagueId, channelType: 'tribe', tribeId: { in: touched }, isArchived: false }, select: { id: true } })
    if (oldChannels.length) await db.survivorChatChannel.updateMany({ where: { id: { in: oldChannels.map((c) => c.id) } }, data: { isArchived: true, archivedAt: now, memberUserIds: [], readOnlyUserIds: [] } })
    await db.survivorTribe.updateMany({ where: { id: { in: touched } }, data: { chatChannelId: null } })
    if (shape.planned) {
      // Back to the original tribes reactivates any that a resize folded; folded tribes retire.
      await db.survivorTribe.updateMany({ where: { id: { in: tribeIds } }, data: { isActive: true, phase: 'pre_merge' } })
      if (retired.length) await db.survivorTribe.updateMany({ where: { id: { in: retired } }, data: { isActive: false, phase: 'dissolved' } })
    }
    await db.survivorTribeMember.deleteMany({ where: { tribeId: { in: touched }, rosterId: { in: [...target.keys()] } } })
    await db.survivorTribeChatMember.deleteMany({ where: { tribeId: { in: touched } } })
    const leaderDone = new Set<string>()
    for (const [rosterId, tribeId] of target) {
      await db.survivorTribeMember.create({ data: { tribeId, rosterId, isLeader: !leaderDone.has(tribeId) } })
      leaderDone.add(tribeId)
      await db.survivorTribeChatMember.create({ data: { tribeId, rosterId, isAiHost: false } })
      const player = players.find((p) => p.redraftRosterId === rosterId)
      if (player) await db.survivorPlayer.update({ where: { leagueId_userId: { leagueId, userId: player.userId } }, data: { tribeId, canAccessTribeChat: true } })
    }
    for (const tribeId of tribeIds) await db.survivorTribeChatMember.create({ data: { tribeId, rosterId: '', userId: 'survivor-ai-host', isAiHost: true } })
    await provisionSurvivorChats(leagueId, { db, actorUserId: opts.actorUserId })
    await db.survivorTribeSwap.update({ where: { id: swap.id }, data: { revealedAt: now } })
    const moved = readTribeSnapshot(swap.beforeSnapshot).reduce((n, t) => n + t.rosterIds.filter((id) => target.get(id) && target.get(id) !== t.tribeId).length, 0)
    await db.survivorAuditEntry.create({ data: { leagueId, week: swap.week, category: 'tribe', action: 'tribe_swap_revealed', actorUserId: opts.actorUserId ?? null,
      data: { swapId: swap.id, moved, forced: Boolean(opts.force), ...(shape.planned ? { swapType: swap.swapType, tribeCount: tribeIds.length, retired, created: created.size } : {}) }, isVisibleToCommissioner: true, isVisibleToPublic: true } })
    if (shape.planned) {
      await db.survivorGameState.updateMany({ where: { leagueId }, data: { activeTribeCount: tribeIds.length } })
      const league = await db.league.findUnique({ where: { id: leagueId }, select: { language: true } })
      await postLeagueAnnouncement(db, leagueId, swapAnnouncementCopy(league?.language ?? null, 'revealed', swap.swapType, tribeIds.length))
    } else {
      await postLeagueAnnouncement(db, leagueId, 'The new tribes are revealed. Idols travel with their owners, and your tribe chat has switched over.')
    }
    return { revealed: true, swapId: swap.id }
  })
}

// ---------------------------------------------------------------- merge naming

async function mergeContext(leagueId: string) {
  const [league, tribes] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true, settings: true, sport: true } }),
    prisma.survivorTribe.findMany({ where: { leagueId }, select: { id: true, name: true, isMerged: true, createdAt: true }, orderBy: { createdAt: 'asc' } }),
  ])
  const merged = [...tribes].reverse().find((t) => t.isMerged) ?? null
  const used = tribes.filter((t) => !t.isMerged).map((t) => t.name)
  const suggestions = mergeNameSuggestions(leagueId, catalog.map((c) => c.name), used)
  const named = merged ? Boolean(await prisma.survivorAuditEntry.findFirst({ where: { leagueId, action: 'merge_tribe_named', relatedEntityId: merged.id }, select: { id: true } })) : false
  const mode: SurvivorMergeNamingMode = readSurvivorLateSeasonSettings(league?.settings).mergeNamingMode
  return { league, merged, suggestions, named, mode }
}

const voteId = (leagueId: string, userId: string) => `merge-name-vote:${leagueId}:${userId}`
const NAME_OK = /^[A-Za-z][A-Za-z' -]{1,22}[A-Za-z]$/

/** Commissioner picks the merged tribe's name (a suggestion, or their own original name). */
export async function nameMergedTribe(leagueId: string, name: string, actorUserId: string | null): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const ctx = await mergeContext(leagueId)
  if (!ctx.merged) return { ok: false, error: 'The tribes have not merged yet.' }
  if (ctx.named) return { ok: false, error: 'The merged tribe already has a name.' }
  const clean = name.trim().replace(/\s+/g, ' ')
  if (!ctx.suggestions.includes(clean) && !NAME_OK.test(clean)) return { ok: false, error: 'Use 3–24 letters for the tribe name.' }
  await prisma.survivorTribe.update({ where: { id: ctx.merged.id }, data: { name: clean } })
  await prisma.survivorChatChannel.updateMany({ where: { leagueId, channelType: 'merge', isArchived: false }, data: { name: clean } })
  await prisma.survivorAuditEntry.create({ data: { leagueId, category: 'tribe', action: 'merge_tribe_named', actorUserId, relatedEntityId: ctx.merged.id, relatedEntityType: 'survivor_tribe',
    data: { name: clean, mode: ctx.mode }, isVisibleToCommissioner: true, isVisibleToPublic: true } })
  const channel = await prisma.survivorChatChannel.findFirst({ where: { leagueId, channelType: 'merge', isArchived: false }, select: { id: true } })
  if (channel) await createSurvivorChatMessage(prisma, { data: { leagueId, channelId: channel.id, channelType: 'merge', ...HOST, content: `Welcome to ${clean}. The tribes are now one.` } }).catch(() => {})
  return { ok: true, name: clean }
}

/** A remaining manager votes for one of the three suggestions; the last vote in names the tribe. */
export async function castMergeNameVote(leagueId: string, userId: string, name: string): Promise<{ ok: true; named: string | null } | { ok: false; error: string }> {
  const ctx = await mergeContext(leagueId)
  if (!ctx.merged) return { ok: false, error: 'The tribes have not merged yet.' }
  if (ctx.mode !== 'manager_vote') return { ok: false, error: 'The commissioner names the merged tribe in this league.' }
  if (ctx.named) return { ok: false, error: 'The merged tribe already has a name.' }
  if (!ctx.suggestions.includes(name)) return { ok: false, error: 'Vote for one of the three suggested names.' }
  const voters = await prisma.survivorPlayer.findMany({ where: { leagueId, playerState: 'active' }, select: { userId: true } })
  if (!voters.some((v) => v.userId === userId)) return { ok: false, error: 'Only managers still in the game vote on the name.' }
  const id = voteId(leagueId, userId)
  await prisma.survivorAuditEntry.upsert({
    where: { id },
    create: { id, leagueId, category: 'tribe', action: 'merge_name_vote', actorUserId: userId, relatedEntityId: ctx.merged.id, data: { name }, isVisibleToCommissioner: false, isVisibleToPublic: false },
    update: { data: { name } },
  })
  const votes = await prisma.survivorAuditEntry.findMany({ where: { leagueId, action: 'merge_name_vote', relatedEntityId: ctx.merged.id }, select: { actorUserId: true, data: true } })
  const counted = votes.filter((v) => voters.some((p) => p.userId === v.actorUserId))
  if (counted.length < voters.length) return { ok: true, named: null }
  const winner = tallyMergeNameVotes(ctx.suggestions, counted.map((v) => String((v.data as Record<string, unknown>)?.name ?? '')))
  if (!winner) return { ok: true, named: null }
  const result = await nameMergedTribe(leagueId, winner, null)
  return { ok: true, named: result.ok ? result.name : null }
}

// ---------------------------------------------------------------- view

export interface ShuffleTribeMeta {
  id: string
  name: string
  crestUrl: string | null
  primary: string
  secondary: string
  /** "Tribe emoji in names" on: the tribe's emoji, else null. Display only; the stored name is unchanged. */
  emoji?: string | null
}

export async function getTribeShuffleView(leagueId: string, viewerUserId: string, now = new Date()) {
  await revealDueTribeSwap(leagueId, { now }).catch((error) => {
    console.error('[survivor-swap] reveal failed', { leagueId, error: error instanceof Error ? error.message : String(error) })
  })
  const [league, swap, tribes, players, rosters, ctx] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true, sport: true, survivorSwapWeek: true, survivorMergeWeek: true, settings: true } }),
    prisma.survivorTribeSwap.findFirst({ where: { leagueId }, orderBy: { executedAt: 'desc' } }),
    prisma.survivorTribe.findMany({ where: { leagueId }, orderBy: { slotIndex: 'asc' }, select: { id: true, name: true, colorHex: true, logoUrl: true, isMerged: true, isActive: true, catalogId: true } }),
    prisma.survivorPlayer.findMany({ where: { leagueId }, select: { userId: true, displayName: true, redraftRosterId: true, playerState: true } }),
    prisma.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true } }),
    mergeContext(leagueId),
  ])
  const sport = league?.sport ?? 'NFL'
  // "Tribe emoji in names" (display only): each column's tribe carries its emoji, so a castaway shows the
  // emoji of the column they stand in — the revealed tribe after the swap, never a sealed one.
  const emojiOn = readSurvivorGovernanceSettings(league?.settings).tribeEmojiInNames
  const meta = (t: (typeof tribes)[number]): ShuffleTribeMeta => {
    const entry = catalog.find((c) => c.name.toLowerCase() === t.name.toLowerCase())
    const colors = buffColorsForTribe({ name: t.name, colorHex: t.colorHex ?? entry?.primary ?? null }, catalog)
    const emoji = emojiOn ? tribeEmojiFor({ name: t.name, catalogId: t.catalogId ?? entry?.id ?? null }) : null
    return { id: t.id, name: castawayNameWithTribeEmoji(t.name, emoji, emojiOn), crestUrl: t.logoUrl ?? (entry ? tribeCrestUrl(entry.id, sport) : null), ...colors, emoji }
  }
  const names: Record<string, string> = {}
  for (const r of rosters) {
    const player = players.find((p) => p.redraftRosterId === r.id || (r.platformUserId && p.userId === r.platformUserId))
    names[r.id] = player?.displayName ?? 'Manager'
  }
  const swapView = swapViewForClient(swap)
  const viewerIsCommissioner = league?.userId === viewerUserId
  const activeVoters = players.filter((p) => p.playerState === 'active')
  const myVote = ctx.merged && ctx.mode === 'manager_vote'
    ? await prisma.survivorAuditEntry.findUnique({ where: { id: voteId(leagueId, viewerUserId) }, select: { data: true } })
    : null
  const voteCount = ctx.merged && ctx.mode === 'manager_vote' && !ctx.named
    ? await prisma.survivorAuditEntry.count({ where: { leagueId, action: 'merge_name_vote', relatedEntityId: ctx.merged.id } })
    : 0
  const mergedMembers = ctx.merged
    ? activeVoters.map((p) => p.redraftRosterId ?? rosters.find((r) => r.platformUserId === p.userId)?.id).filter((id): id is string => Boolean(id))
    : []
  return {
    swapWeek: league?.survivorSwapWeek ?? swap?.week ?? null,
    mergeWeek: league?.survivorMergeWeek ?? null,
    names,
    tribes: tribes.filter((t) => !t.isMerged).map(meta),
    swap: swapView,
    merge: ctx.merged
      ? {
          tribeId: ctx.merged.id,
          name: ctx.named ? ctx.merged.name : null,
          provisionalName: PROVISIONAL_MERGED_TRIBE_NAME,
          named: ctx.named,
          mode: ctx.mode,
          suggestions: ctx.suggestions,
          myVote: typeof (myVote?.data as Record<string, unknown> | undefined)?.name === 'string' ? String((myVote!.data as Record<string, unknown>).name) : null,
          votesIn: voteCount,
          votersTotal: activeVoters.length,
          canVote: ctx.mode === 'manager_vote' && !ctx.named && activeVoters.some((p) => p.userId === viewerUserId),
          canName: viewerIsCommissioner && !ctx.named && ctx.mode === 'commissioner',
          members: mergedMembers,
        }
      : null,
    viewer: { isCommissioner: viewerIsCommissioner, rosterId: rosters.find((r) => r.platformUserId === viewerUserId)?.id ?? null },
    sealed: isSwapSealed(swap),
  }
}

export type TribeShuffleView = Awaited<ReturnType<typeof getTribeShuffleView>>
