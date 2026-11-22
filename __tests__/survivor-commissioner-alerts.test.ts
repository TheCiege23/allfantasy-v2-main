/**
 * Commissioner alerts reach the league owner once per (kind, key), survive retries through an
 * audit row, and never fire without a commissioner to send to.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { notifySurvivorCommissionerOnce, survivorCommissionerAlertKey } from '@/lib/survivor/survivorCommissionerAlerts'

function fakeDb(opts: { already?: boolean; owner?: string | null } = {}) {
  return {
    survivorAuditEntry: {
      findFirst: vi.fn(async () => (opts.already ? { id: 'audit-1' } : null)),
      create: vi.fn(async () => ({ id: 'audit-2' })),
    },
    league: { findUnique: vi.fn(async () => ({ userId: opts.owner === undefined ? 'owner-1' : opts.owner })) },
    survivorNotification: { create: vi.fn(async () => ({ id: 'notif-1' })) },
  }
}

describe('notifySurvivorCommissionerOnce', () => {
  it('queues one spoiler-safe commissioner notification and records the dedupe audit row', async () => {
    const db = fakeDb()
    const out = await notifySurvivorCommissionerOnce('league-1', 'tie_unresolved', { dedupeKey: 'council-9', week: 4, title: 'Tied', body: 'Pick.', deepLinkPath: '/survivor/league-1/tribal' }, db as never)
    expect(out).toEqual({ sent: true, notificationId: 'notif-1' })
    expect(db.survivorNotification.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      type: 'commissioner_tie_unresolved', recipientUserId: 'owner-1', recipientRole: 'commissioner', isSpoilerSafe: true, status: 'pending', deepLinkPath: '/survivor/league-1/tribal',
    }) }))
    expect(db.survivorAuditEntry.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      action: 'commissioner_alert_sent', relatedEntityId: survivorCommissionerAlertKey('tie_unresolved', 'council-9'), week: 4, isVisibleToPublic: false,
    }) }))
  })

  it('sends nothing the second time for the same kind and key', async () => {
    const db = fakeDb({ already: true })
    const out = await notifySurvivorCommissionerOnce('league-1', 'scores_overdue', { dedupeKey: '5', title: 't', body: 'b' }, db as never)
    expect(out).toEqual({ sent: false, reason: 'duplicate' })
    expect(db.survivorNotification.create).not.toHaveBeenCalled()
    expect(db.survivorAuditEntry.create).not.toHaveBeenCalled()
  })

  it('does nothing for a league without an owner', async () => {
    const db = fakeDb({ owner: null })
    expect(await notifySurvivorCommissionerOnce('league-1', 'automation_error', { dedupeKey: '2026-10-20', title: 't', body: 'b' }, db as never)).toEqual({ sent: false, reason: 'no_commissioner' })
    expect(db.survivorNotification.create).not.toHaveBeenCalled()
  })
})
