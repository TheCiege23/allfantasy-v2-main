import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = { id: string; leagueId: string; status: string; scheduledFor: Date | null; recipientUserId: string | null; recipientRole: string | null; type: string; title: string; body: string; isSpoilerSafe: boolean; urgency: string; deepLinkPath: string | null }

const rows = vi.hoisted(() => [] as Row[])
const db = vi.hoisted(() => ({
  survivorNotification: { findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  platformNotification: { create: vi.fn() },
  leagueTeam: { findMany: vi.fn(), findFirst: vi.fn() },
  survivorPlayer: { findMany: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
const dispatch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: dispatch }))

import { processDueSurvivorNotifications, processNotificationQueue } from '@/lib/survivor/notificationEngine'

const now = new Date('2026-11-03T18:00:00Z')
function row(id: string, overrides: Partial<Row> = {}): Row {
  return { id, leagueId: 'league-1', status: 'pending', scheduledFor: new Date(now.getTime() - 60_000), recipientUserId: 'user-1', recipientRole: null, type: 'vote_reminder', title: 'Votes close soon', body: 'Cast your vote.', isSpoilerSafe: true, urgency: 'high', deepLinkPath: null, ...overrides }
}
function matches(r: Row, where: Record<string, unknown>) {
  if (where.id && r.id !== where.id) return false
  if (where.leagueId && r.leagueId !== where.leagueId) return false
  if (where.status && r.status !== where.status) return false
  const lt = (where.scheduledFor as { lt?: Date } | undefined)?.lt
  if (lt && !(r.scheduledFor && r.scheduledFor < lt)) return false
  if (where.OR) return !r.scheduledFor || r.scheduledFor <= now
  return true
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(now)
  rows.length = 0
  db.survivorNotification.findMany.mockImplementation(async ({ where, distinct }) => {
    const found = rows.filter(r => matches(r, where))
    return distinct ? [...new Map(found.map(r => [r.leagueId, { leagueId: r.leagueId }])).values()] : found.map(r => ({ ...r }))
  })
  db.survivorNotification.updateMany.mockImplementation(async ({ where, data }) => {
    const hit = rows.filter(r => matches(r, where))
    hit.forEach(r => Object.assign(r, data))
    return { count: hit.length }
  })
  db.survivorNotification.update.mockImplementation(async ({ where, data }) => Object.assign(rows.find(r => r.id === where.id)!, data))
})

describe('Survivor notification delivery', () => {
  it('delivers due rows across leagues from the scheduled tick', async () => {
    rows.push(row('a'), row('b', { leagueId: 'league-2', recipientUserId: 'user-2' }), row('later', { scheduledFor: new Date(now.getTime() + 3_600_000) }))
    expect(await processDueSurvivorNotifications(now)).toEqual({ leagues: 2, sent: 2, failed: 0 })
    expect(dispatch).toHaveBeenCalledTimes(2)
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      userIds: ['user-1'], category: 'league_announcements', type: 'survivor:vote_reminder', title: 'Votes close soon',
      leagueId: 'league-1', severity: 'medium', dedupePrefix: 'survivor:a',
    }))
    expect(rows.find(r => r.id === 'later')?.status).toBe('pending')
  })

  it('retires reminders that are a day past due instead of sending them', async () => {
    rows.push(row('stale', { scheduledFor: new Date(now.getTime() - 25 * 3_600_000) }))
    await processNotificationQueue('league-1')
    expect(rows[0].status).toBe('expired')
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('does not deliver a row another tick already claimed', async () => {
    rows.push(row('a'))
    db.survivorNotification.findMany.mockImplementationOnce(async () => {
      const snapshot = rows.map(r => ({ ...r }))
      rows[0].status = 'sending' // a concurrent tick won the claim
      return snapshot
    })
    expect(await processNotificationQueue('league-1')).toEqual({ sent: 0, failed: 0 })
    expect(dispatch).not.toHaveBeenCalled()
  })
  it('files commissioner-only notices under commissioner alerts', async () => {
    rows.push(row('c', { type: 'draft_cast_incomplete', recipientUserId: 'commish' }))
    await processNotificationQueue('league-1')
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ userIds: ['commish'], category: 'commissioner_alerts' }))
  })
})
