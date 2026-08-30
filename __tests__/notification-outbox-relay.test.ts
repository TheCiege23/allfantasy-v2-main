/**
 * NOTIFICATION OUTBOX RELAY — regression guard.
 *
 * WHY THIS FILE EXISTS
 * `notification_outbox` was write-only for its whole life. `lib/automation/notifications.ts`
 * documented the consumer as future work ("Twilio / Resend dispatch reads from this table in a
 * later worker") and it was never written, so production sat at 4 rows, all `pending`, all
 * `attemptCount: 0`, newest 2026-06-21. Nothing failed — nothing had ever tried.
 *
 * That is not a bug a type checker or a build can catch: the producer compiles, the table exists,
 * and every enqueue succeeds. The only thing that catches an absent consumer is a test that
 * asserts a queued row actually leaves the queue. That is what this is.
 *
 * The `waiver results` case at the bottom is the one that matters for the season:
 * `processLeagueWaiversJob` is the largest producer and the waivers cron runs every 5 minutes.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const outboxFindMany = vi.fn()
const outboxUpdateMany = vi.fn()
const outboxUpdate = vi.fn()
const appUserFindUnique = vi.fn()
const leagueFindUnique = vi.fn()
const platformNotificationCreate = vi.fn()
const leagueChatMessageCreate = vi.fn()

const sendNotificationEmail = vi.fn()
const sendPushToUser = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    notificationOutbox: {
      findMany: (...a: unknown[]) => outboxFindMany(...a),
      updateMany: (...a: unknown[]) => outboxUpdateMany(...a),
      update: (...a: unknown[]) => outboxUpdate(...a),
    },
    appUser: { findUnique: (...a: unknown[]) => appUserFindUnique(...a) },
    league: { findUnique: (...a: unknown[]) => leagueFindUnique(...a) },
    platformNotification: { create: (...a: unknown[]) => platformNotificationCreate(...a) },
    leagueChatMessage: { create: (...a: unknown[]) => leagueChatMessageCreate(...a) },
  },
}))

vi.mock('@/lib/resend-client', () => ({
  sendNotificationEmail: (...a: unknown[]) => sendNotificationEmail(...a),
}))

vi.mock('@/lib/push-notifications/push-service', () => ({
  sendPushToUser: (...a: unknown[]) => sendPushToUser(...a),
}))

import { relayNotificationOutbox } from '@/lib/notifications/outboxRelay'

type Row = Record<string, unknown>

/** Wires the two-step read the relay does: ids to claim, then the claimed rows. */
function stageRows(rows: Row[]) {
  outboxFindMany
    .mockResolvedValueOnce(rows.map((r) => ({ id: r.id })))
    .mockResolvedValueOnce(rows)
  outboxUpdateMany.mockResolvedValue({ count: rows.length })
}

function row(over: Partial<Row> = {}): Row {
  return {
    id: 'row-1',
    leagueId: null,
    userId: 'user-1',
    channel: 'email',
    eventType: 'waiver_result',
    title: 'Claim won',
    body: 'You won Puka Nacua.',
    attemptCount: 0,
    maxAttempts: 3,
    metadata: null,
    ...over,
  }
}

/** The `data` of the single `update` the relay writes back for a row. */
function writeback(): Record<string, unknown> {
  expect(outboxUpdate).toHaveBeenCalledTimes(1)
  return (outboxUpdate.mock.calls[0]![0] as { data: Record<string, unknown> }).data
}

beforeEach(() => {
  /*
   * resetAllMocks, NOT clearAllMocks. `mockClear` leaves the `mockResolvedValueOnce` QUEUE intact,
   * and the dry-run case stages two queued reads but consumes only one — so a leftover value
   * carried into the next test and it read someone else's rows. Every default below is re-armed
   * immediately after, so resetting implementations costs nothing.
   */
  vi.resetAllMocks()
  outboxUpdate.mockResolvedValue({})
  appUserFindUnique.mockResolvedValue({ email: 'manager@example.com' })
  leagueFindUnique.mockResolvedValue({ userId: 'commish-1' })
  platformNotificationCreate.mockResolvedValue({})
  leagueChatMessageCreate.mockResolvedValue({})
  sendNotificationEmail.mockResolvedValue({ ok: true })
  sendPushToUser.mockResolvedValue([{ ok: true }])
})

describe('notification outbox relay', () => {
  it('claims pending rows conditionally so two concurrent runs cannot double-send', async () => {
    stageRows([row()])
    await relayNotificationOutbox()

    const claim = outboxUpdateMany.mock.calls[0]![0] as {
      where: Record<string, unknown>
      data: Record<string, unknown>
    }
    // `status: 'pending'` in the WHERE is the entire concurrency story — without it, a second
    // overlapping run re-reads the same row and sends it again. The fast tier can be superseded
    // mid-window, so overlap is a real state, not a theoretical one.
    expect(claim.where.status).toBe('pending')
    expect(claim.data.status).toBe('sending')
  })

  it('sends an email row and marks it sent with a sentAt', async () => {
    stageRows([row({ metadata: { actionHref: '/league/1', actionLabel: 'View' } })])

    const result = await relayNotificationOutbox()

    expect(sendNotificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'manager@example.com',
        subject: 'Claim won',
        actionHref: '/league/1',
        actionLabel: 'View',
      }),
    )
    const data = writeback()
    expect(data.status).toBe('sent')
    // `sentAt` is what scripts/cron-freshness-check.mjs probes. If this stops being written the
    // monitor goes blind to exactly the failure it was added for.
    expect(data.sentAt).toBeInstanceOf(Date)
    expect(result.sent).toBe(1)
  })

  it('returns a transient send failure to pending for retry, not to failed', async () => {
    sendNotificationEmail.mockResolvedValue({ ok: false, error: 'rate limited' })
    stageRows([row({ attemptCount: 0, maxAttempts: 3 })])

    const result = await relayNotificationOutbox()

    const data = writeback()
    expect(data.status).toBe('pending')
    expect(data.attemptCount).toBe(1)
    expect(data.lastError).toContain('rate limited')
    expect(result.retried).toBe(1)
  })

  it('gives up once maxAttempts is spent instead of retrying forever', async () => {
    sendNotificationEmail.mockResolvedValue({ ok: false, error: 'mailbox full' })
    stageRows([row({ attemptCount: 2, maxAttempts: 3 })])

    const result = await relayNotificationOutbox()

    expect(writeback().status).toBe('failed')
    expect(result.failed).toBe(1)
  })

  it('records a thrown dispatch error rather than losing the row', async () => {
    sendNotificationEmail.mockRejectedValue(new Error('socket hang up'))
    stageRows([row()])

    const result = await relayNotificationOutbox()

    const data = writeback()
    expect(data.status).toBe('pending')
    expect(data.lastError).toContain('socket hang up')
    expect(result.retried).toBe(1)
  })

  it('does not retry a push row forever when the user has no subscriptions', async () => {
    // Zero subscriptions is a legitimate end state, not a transient fault — the user never granted
    // push. Retrying every 5 minutes to maxAttempts would spend the queue on users who can never
    // receive it. Production had 0 rows in web_push_subscriptions when this was written.
    sendPushToUser.mockResolvedValue([])
    stageRows([row({ channel: 'push' })])

    const result = await relayNotificationOutbox()

    expect(writeback().status).toBe('failed')
    expect(result.skipped).toBe(1)
  })

  it('writes an in_app row to platform_notifications', async () => {
    stageRows([row({ channel: 'in_app', leagueId: 'league-1' })])

    await relayNotificationOutbox()

    expect(platformNotificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: 'user-1', leagueId: 'league-1', title: 'Claim won' }),
      }),
    )
    expect(writeback().status).toBe('sent')
  })

  it('posts a league_chat row as the league owner', async () => {
    stageRows([row({ channel: 'league_chat', userId: null, leagueId: 'league-1' })])

    await relayNotificationOutbox()

    // LeagueChatMessage.userId is required and FKs to AppUser, so a system post needs a real
    // author; the league owner is the convention lib/league/faqGenerator.ts already uses.
    expect(leagueChatMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ leagueId: 'league-1', userId: 'commish-1' }),
      }),
    )
    expect(writeback().status).toBe('sent')
  })

  it('fails an unimplemented channel loudly instead of dropping it', async () => {
    stageRows([row({ channel: 'sms' })])

    const result = await relayNotificationOutbox()

    const data = writeback()
    expect(data.status).toBe('failed')
    expect(String(data.lastError)).toContain('sms')
    expect(result.skipped).toBe(1)
  })

  it('dispatches nothing on a dry run', async () => {
    stageRows([row()])

    const result = await relayNotificationOutbox({ dryRun: true })

    expect(outboxUpdateMany).not.toHaveBeenCalled()
    expect(sendNotificationEmail).not.toHaveBeenCalled()
    expect(result.claimed).toBe(1)
  })

  it('drains a waiver-result batch end to end', async () => {
    // The season case. processLeagueWaiversJob enqueues one user notification per claim plus a
    // league-chat announcement; the waivers cron fires every 5 minutes from week 1.
    stageRows([
      row({ id: 'w1', channel: 'email', userId: 'u1', title: 'Waiver claim won' }),
      row({ id: 'w2', channel: 'push', userId: 'u2', title: 'Waiver claim lost' }),
      row({ id: 'w3', channel: 'league_chat', userId: null, leagueId: 'l1', title: 'Waivers processed' }),
    ])

    const result = await relayNotificationOutbox()

    expect(result.sent).toBe(3)
    expect(result.failed).toBe(0)
    expect(outboxUpdate).toHaveBeenCalledTimes(3)
    for (const call of outboxUpdate.mock.calls) {
      expect((call[0] as { data: { status: string } }).data.status).toBe('sent')
    }
  })
})
