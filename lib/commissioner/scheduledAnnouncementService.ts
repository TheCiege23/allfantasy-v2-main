import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { broadcastRefusal } from './broadcastAccess'
import { postLeagueAnnouncement } from './postLeagueAnnouncement'
import {
  SCHEDULED_ANNOUNCEMENTS_KEY,
  dueAnnouncements,
  parseScheduleInput,
  readScheduledAnnouncements,
  staleClaims,
  updateAnnouncement,
  withScheduledAnnouncements,
  type ScheduleInputError,
  type ScheduledAnnouncement,
} from './scheduledAnnouncements'

/**
 * Scheduled league announcements: write, list, cancel, and the sweep that posts them
 * (./scheduledAnnouncements for the rules). Every write is a read-modify-write of League.settings
 * under a row lock, so a commissioner's save and the sweep's claim cannot drop each other.
 */

type Tx = Prisma.TransactionClient

async function mutate<T>(
  leagueId: string,
  fn: (list: ScheduledAnnouncement[]) => { list: ScheduledAnnouncement[]; result: T } | null,
): Promise<T | null> {
  return prisma.$transaction(async (t: Tx) => {
    await t.$queryRaw`SELECT id FROM leagues WHERE id = ${leagueId} FOR UPDATE`
    const row = await t.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
    if (!row) return null
    const out = fn(readScheduledAnnouncements(row.settings))
    if (!out) return null
    await t.league.update({ where: { id: leagueId }, data: { settings: withScheduledAnnouncements(row.settings, out.list) as object } })
    return out.result
  })
}

export async function listScheduledAnnouncements(leagueId: string): Promise<ScheduledAnnouncement[]> {
  const row = await prisma.league.findFirst({ where: { id: leagueId }, select: { settings: true } })
  return readScheduledAnnouncements(row?.settings)
}

export async function scheduleAnnouncement(
  leagueId: string,
  userId: string,
  body: unknown,
  now = new Date(),
): Promise<{ ok: true; announcement: ScheduledAnnouncement } | { ok: false; error: ScheduleInputError }> {
  const refused: { error?: ScheduleInputError } = {}
  const created = await mutate(leagueId, (list) => {
    const parsed = parseScheduleInput(body, list, now)
    if (!parsed.ok) {
      refused.error = parsed.error
      return null
    }
    const a: ScheduledAnnouncement = {
      id: randomUUID(),
      message: parsed.value.message,
      sendAt: parsed.value.sendAt,
      byUserId: userId,
      createdAt: now.toISOString(),
      status: 'pending',
    }
    return { list: [...list, a], result: a }
  })
  if (refused.error) return { ok: false, error: refused.error }
  if (!created) return { ok: false, error: 'bad_message' }
  await audit(leagueId, userId, 'announcement_scheduled', { announcementId: created.id, sendAt: created.sendAt })
  return { ok: true, announcement: created }
}

/** Cancel a post that has not gone out. False when it is unknown or already sending/sent. */
export async function cancelScheduledAnnouncement(leagueId: string, userId: string, id: string, now = new Date()): Promise<boolean> {
  const done = await mutate(leagueId, (list) => {
    const a = list.find((x) => x.id === id)
    if (!a || a.status !== 'pending') return null
    return { list: updateAnnouncement(list, id, { status: 'cancelled', finishedAt: now.toISOString(), reason: 'Cancelled' }), result: true }
  })
  if (done) await audit(leagueId, userId, 'announcement_cancelled', { announcementId: id })
  return Boolean(done)
}

async function audit(leagueId: string, userId: string | null, actionType: string, metadata: Record<string, unknown>) {
  try {
    await prisma.leagueAuditLog.create({ data: { leagueId, userId, actionType, entityType: 'announcement', metadata: metadata as object } })
  } catch (e) {
    console.warn('[scheduled-announcements] audit write failed', e instanceof Error ? e.message : e)
  }
}

export type ScheduledAnnouncementRun = {
  ran: true
  leagues: number
  sent: number
  failed: number
  refused: number
  staleFailed: number
  budgetStopped: boolean
  errors: Array<{ leagueId: string; error: string }>
}

/**
 * Post every due announcement. Each one is CLAIMED under the row lock first, so two sweeps (two
 * worker replicas) can never both send it, then permission is re-checked for the person who
 * scheduled it — a co-commissioner removed since, or one who lost the chat permission, does not get
 * a post out of an old schedule.
 */
export async function runScheduledAnnouncements(opts: { dryRun?: boolean; budgetMs?: number; now?: Date } = {}): Promise<ScheduledAnnouncementRun> {
  const started = Date.now()
  const now = opts.now ?? new Date()
  const run: ScheduledAnnouncementRun = { ran: true, leagues: 0, sent: 0, failed: 0, refused: 0, staleFailed: 0, budgetStopped: false, errors: [] }
  // Only leagues that hold the key at all; an index is not needed at this table's size.
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM leagues WHERE jsonb_exists(settings, ${SCHEDULED_ANNOUNCEMENTS_KEY})`
  for (const { id: leagueId } of rows) {
    if (opts.budgetMs != null && Date.now() - started > opts.budgetMs) {
      run.budgetStopped = true
      break
    }
    run.leagues += 1
    try {
      if (opts.dryRun) {
        const list = await listScheduledAnnouncements(leagueId)
        run.sent += dueAnnouncements(list, now).length
        continue
      }
      const claimed = await mutate(leagueId, (list) => {
        const stale = staleClaims(list, now)
        const due = dueAnnouncements(list, now)
        if (!stale.length && !due.length) return null
        let next = list
        for (const a of stale) {
          next = updateAnnouncement(next, a.id, { status: 'failed', finishedAt: now.toISOString(), reason: 'Interrupted while posting — not re-sent, to avoid a double post' })
        }
        for (const a of due) next = updateAnnouncement(next, a.id, { status: 'sending', claimedAt: now.toISOString() })
        return { list: next, result: { due, stale: stale.length } }
      })
      if (!claimed) continue
      run.staleFailed += claimed.stale
      for (const a of claimed.due) {
        const refusal = await broadcastRefusal(leagueId, a.byUserId).catch((): 'forbidden' => 'forbidden')
        let patch: Partial<ScheduledAnnouncement>
        if (refusal) {
          run.refused += 1
          patch = {
            status: 'failed',
            reason: refusal === 'imported' ? 'This league no longer runs on AllFantasy' : 'Whoever scheduled it can no longer send announcements here',
          }
        } else {
          const sent = await postLeagueAnnouncement(leagueId, a.byUserId, a.message).catch(() => false)
          if (sent) run.sent += 1
          else run.failed += 1
          patch = sent ? { status: 'sent' } : { status: 'failed', reason: 'League chat did not accept the post' }
        }
        await mutate(leagueId, (list) => ({ list: updateAnnouncement(list, a.id, { ...patch, finishedAt: new Date().toISOString() }), result: true }))
        await audit(leagueId, null, patch.status === 'sent' ? 'announcement_posted' : 'announcement_failed', {
          announcementId: a.id,
          byUserId: a.byUserId,
          ...(patch.reason ? { reason: patch.reason } : {}),
        })
      }
    } catch (err) {
      run.errors.push({ leagueId, error: err instanceof Error ? err.message.slice(0, 160) : String(err).slice(0, 160) })
    }
  }
  return run
}
