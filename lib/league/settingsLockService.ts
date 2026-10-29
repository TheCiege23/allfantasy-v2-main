import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isPollClosed, readViewerPoll } from '@/lib/chat-core/messagePolls'
import { structuralSettingsLockReason } from '@/lib/league/structuralSettingsLock'
import {
  DEFAULT_VOTE_DAYS,
  LOCK_GROUPS,
  NO,
  VOTE_DAY_OPTIONS,
  YES,
  changedPatchKeys,
  isGroupLocked,
  lockedGroupsFor,
  readSettingsLock,
  resolveUnlockVotes,
  unlockPollQuestion,
  withSettingsLock,
  type LockGroup,
  type SettingsLock,
  type UnlockVote,
} from './settingsLock'

/**
 * Settings lock — storage, the unlock vote, and the check every settings writer calls
 * (./settingsLock for the rules).
 *
 * ⚠ VOTES RESOLVE LAZILY: whenever the lock is read, and whenever a writer asks whether it may write.
 * A vote that passed at 3am opens its area the first time anybody looks, which is the first moment it
 * matters. No cron.
 */

type Tx = Prisma.TransactionClient

async function pollCounts(messageId: string | null, now: Date): Promise<{ yes: number; no: number; closed: boolean } | null> {
  if (!messageId) return null
  const row = await prisma.leagueChatMessage.findUnique({ where: { id: messageId }, select: { metadata: true } }).catch(() => null)
  const poll = row ? readViewerPoll(row.metadata, null) : null
  if (!poll) return null
  const count = (id: string) => poll.options.find((o) => o.id === id)?.count ?? 0
  return { yes: count(YES), no: count(NO), closed: isPollClosed(poll, now.getTime()) }
}

/** Read-modify-write of the lock under a row lock. `fn` returning null writes nothing. */
async function mutateLock<T>(
  leagueId: string,
  fn: (lock: SettingsLock | null, season: number | null) => { lock: SettingsLock | null; result: T } | null,
): Promise<T | null> {
  return prisma.$transaction(async (t: Tx) => {
    await t.$queryRaw`SELECT id FROM leagues WHERE id = ${leagueId} FOR UPDATE`
    const row = await t.league.findUnique({ where: { id: leagueId }, select: { settings: true, season: true } })
    if (!row) return null
    const out = fn(readSettingsLock(row.settings, row.season), row.season ?? null)
    if (!out) return null
    await t.league.update({ where: { id: leagueId }, data: { settings: withSettingsLock(row.settings, out.lock) as object } })
    return out.result
  })
}

async function audit(leagueId: string, userId: string | null, actionType: string, metadata: Record<string, unknown>) {
  try {
    await prisma.leagueAuditLog.create({ data: { leagueId, userId, actionType, entityType: 'settings_lock', metadata: metadata as object } })
  } catch (e) {
    console.warn('[settings-lock] audit write failed', e instanceof Error ? e.message : e)
  }
}

/** The lock in force, with any vote whose poll has closed resolved (and saved) first. */
export async function currentSettingsLock(leagueId: string, now = new Date()): Promise<SettingsLock | null> {
  const row = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, season: true } })
  const lock = row ? readSettingsLock(row.settings, row.season) : null
  if (!lock || !lock.votes.some((v) => v.status === 'voting')) return lock
  const counts = new Map<string, { yes: number; no: number; closed: boolean } | null>()
  for (const v of lock.votes) if (v.status === 'voting') counts.set(v.id, await pollCounts(v.pollMessageId, now))
  if (!resolveUnlockVotes(lock, (v) => counts.get(v.id) ?? null, now).resolved.length) return lock
  const resolved = await mutateLock(leagueId, (fresh) => {
    if (!fresh) return null
    const r = resolveUnlockVotes(fresh, (v) => counts.get(v.id) ?? null, now)
    return r.resolved.length ? { lock: r.lock, result: r } : null
  })
  for (const v of resolved?.resolved ?? []) {
    await audit(leagueId, null, `settings_unlock_vote_${v.status}`, { voteId: v.id, group: v.group, yes: v.yes, no: v.no })
  }
  return resolved?.lock ?? readSettingsLock((await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } }))?.settings, row?.season)
}

/** Which of `groups` are locked right now. The check a dedicated settings writer calls. */
export async function lockedGroups(leagueId: string, groups: readonly LockGroup[], now = new Date()): Promise<LockGroup[]> {
  const lock = await currentSettingsLock(leagueId, now)
  return groups.filter((g) => isGroupLocked(lock, g, now))
}

/**
 * The locked groups a league-settings patch would change, comparing each key with what is stored
 * (`league` is the row executeLeagueSettingsPatch already loaded, with `leagueSettings`).
 */
export async function lockedGroupsForPatch(
  leagueId: string,
  league: Record<string, unknown> & { settings?: unknown; leagueSettings?: unknown },
  body: Record<string, unknown>,
  now = new Date(),
): Promise<LockGroup[]> {
  const lock = await currentSettingsLock(leagueId, now)
  if (!lock || !lock.groups.length) return []
  const settings = (league.settings && typeof league.settings === 'object' ? league.settings : {}) as Record<string, unknown>
  const row = (league.leagueSettings && typeof league.leagueSettings === 'object' ? league.leagueSettings : null) as Record<string, unknown> | null
  const current = (key: string, fromSettings: boolean): unknown => {
    if (fromSettings) return key in settings ? settings[key] : undefined
    if (key in league) return league[key]
    if (row && key in row) return row[key]
    return key in settings ? settings[key] : undefined
  }
  return lockedGroupsFor(lock, changedPatchKeys(body, current), now)
}

export type LockView = {
  season: number | null
  /** True once the draft has started or the season exists: unlocking then needs a vote. */
  seasonUnderway: boolean
  groups: Array<{ group: LockGroup; locked: boolean; unlockedUntil: string | null }>
  votes: UnlockVote[]
}

export async function readLockView(leagueId: string, now = new Date()): Promise<LockView | null> {
  const row = await prisma.league.findUnique({ where: { id: leagueId }, select: { season: true } })
  if (!row) return null
  const [lock, underway] = await Promise.all([currentSettingsLock(leagueId, now), structuralSettingsLockReason(leagueId)])
  return {
    season: row.season ?? null,
    seasonUnderway: underway != null,
    groups: LOCK_GROUPS.map((g) => {
      const until = lock?.unlockedUntil[g]
      return {
        group: g,
        locked: Boolean(lock?.groups.includes(g)),
        unlockedUntil: until && Date.parse(until) > now.getTime() && lock?.groups.includes(g) ? until : null,
      }
    }),
    votes: lock?.votes ?? [],
  }
}

export type SetGroupsError = 'vote_required' | 'not_found'

/**
 * Set which groups are locked. Adding is always allowed. Removing one once the season is under way is
 * refused — that is what the vote is for.
 */
export async function setLockedGroups(
  leagueId: string,
  userId: string,
  groups: readonly LockGroup[],
  now = new Date(),
): Promise<{ ok: true; groups: LockGroup[] } | { ok: false; error: SetGroupsError; groups?: LockGroup[] }> {
  const underway = (await structuralSettingsLockReason(leagueId)) != null
  const refusal: { removed?: LockGroup[] } = {}
  const result = await mutateLock(leagueId, (lock, season) => {
    const before = lock?.groups ?? []
    const removed = before.filter((g) => !groups.includes(g))
    if (removed.length && underway) {
      refusal.removed = removed
      return null
    }
    const next: SettingsLock = lock
      ? { ...lock, groups: LOCK_GROUPS.filter((g) => groups.includes(g)) }
      : { season, groups: LOCK_GROUPS.filter((g) => groups.includes(g)), lockedAt: now.toISOString(), lockedBy: userId, unlockedUntil: {}, votes: [] }
    for (const g of removed) delete next.unlockedUntil[g]
    return { lock: next, result: { before, after: next.groups } }
  })
  if (refusal.removed) return { ok: false, error: 'vote_required', groups: refusal.removed }
  if (!result) return { ok: false, error: 'not_found' }
  const added = result.after.filter((g) => !result.before.includes(g))
  const removed = result.before.filter((g) => !result.after.includes(g))
  if (added.length || removed.length) await audit(leagueId, userId, 'settings_lock_changed', { added, removed })
  return { ok: true, groups: result.after }
}

export type StartVoteError = 'not_locked' | 'already_voting' | 'bad_days' | 'poll_failed' | 'not_found'

/** Post a yes/no league-chat poll to unlock one group. */
export async function startUnlockVote(
  leagueId: string,
  userId: string,
  body: { group?: unknown; days?: unknown; reason?: unknown },
  now = new Date(),
): Promise<{ ok: true; vote: UnlockVote } | { ok: false; error: StartVoteError }> {
  const group = LOCK_GROUPS.find((g) => g === body.group)
  const days = body.days === undefined ? DEFAULT_VOTE_DAYS : Number(body.days)
  if (!(VOTE_DAY_OPTIONS as readonly number[]).includes(days)) return { ok: false, error: 'bad_days' }
  const lock = await currentSettingsLock(leagueId, now)
  if (!group || !isGroupLocked(lock, group, now)) return { ok: false, error: 'not_locked' }
  if (lock!.votes.some((v) => v.group === group && v.status === 'voting')) return { ok: false, error: 'already_voting' }

  const vote: UnlockVote = {
    id: randomUUID(),
    group,
    reason: typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) : '',
    pollMessageId: null,
    closesAt: new Date(now.getTime() + days * 86_400_000).toISOString(),
    status: 'voting',
    yes: null,
    no: null,
    proposedBy: userId,
    proposedAt: now.toISOString(),
    resolvedAt: null,
  }
  const question = unlockPollQuestion(group, vote.closesAt)
  try {
    const { createLeagueChatMessage } = await import('@/lib/league-chat/LeagueChatMessageService')
    // The idempotency key IS the row id (LeagueChatMessageService), so the poll is findable by it.
    const pollId = `settings-unlock-poll:${vote.id}`
    const msg = await createLeagueChatMessage(leagueId, userId, `${question}${vote.reason ? `\n${vote.reason}` : ''}`, {
      idempotencyKey: pollId,
      type: 'poll',
      source: null,
      metadata: {
        kind: 'settings_unlock_vote',
        voteId: vote.id,
        poll: {
          question,
          options: [
            { id: YES, text: 'Yes, unlock', votes: [] },
            { id: NO, text: 'No, keep it locked', votes: [] },
          ],
          closeAt: vote.closesAt,
          allowMultiple: false,
          anonymous: false,
        },
      },
    })
    vote.pollMessageId = (msg as { id?: string } | null)?.id ?? pollId
  } catch (e) {
    console.warn('[settings-lock] unlock poll failed', e instanceof Error ? e.message : e)
    return { ok: false, error: 'poll_failed' }
  }
  if (!vote.pollMessageId) return { ok: false, error: 'poll_failed' }
  const saved = await mutateLock(leagueId, (fresh) => (fresh ? { lock: { ...fresh, votes: [vote, ...fresh.votes] }, result: true } : null))
  if (!saved) return { ok: false, error: 'not_found' }
  await audit(leagueId, userId, 'settings_unlock_vote_started', { voteId: vote.id, group, closesAt: vote.closesAt })
  return { ok: true, vote }
}
