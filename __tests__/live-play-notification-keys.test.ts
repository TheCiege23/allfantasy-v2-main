import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Two ways a SECOND touchdown by the same player used to vanish, one per layer:
 *
 *   1. the engine's cooldown key was `type:playerId:playerName`, so inside the
 *      10-minute `live_score_swing` window the second play shared the first
 *      one's key and was dropped for everyone who got the first;
 *   2. the push tag was one per category, so even a sent alert REPLACED the
 *      previous one on the device.
 */

const h = vi.hoisted(() => ({ findMany: vi.fn(), dispatch: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { platformNotification: { findMany: h.findMany }, leagueTeam: { findMany: vi.fn(async () => []) } },
}))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: h.dispatch }))

import { ingest } from '@/lib/notification-engine'
import { pushTagFor } from '@/lib/notifications/pushTag'

const play = (key: string) => ({
  type: 'live_score_swing' as const,
  title: 'Touchdown',
  body: 'Ashton Jeanty 34-yard rushing TD',
  userIds: ['u1'],
  meta: { playerId: '101', playerName: 'Ashton Jeanty', idempotencyKey: key },
})

beforeEach(() => {
  h.findMany.mockReset()
  h.dispatch.mockReset()
  h.dispatch.mockResolvedValue(undefined)
})

describe('engine cooldown key', () => {
  it("a player's second touchdown inside the cooldown still reaches the manager who got the first", async () => {
    // u1 already received the FIRST touchdown within the window.
    h.findMany.mockImplementation(async (args: { where: { meta: { equals: string } } }) =>
      args.where.meta.equals.includes('pbp:G:10:TOUCHDOWN') ? [{ userId: 'u1' }] : [],
    )
    const again = await ingest(play('pbp:G:10:TOUCHDOWN'))
    const second = await ingest(play('pbp:G:88:TOUCHDOWN'))

    // The same play re-sent by an overlapping tick is still deduped...
    expect(again).toMatchObject({ dispatched: false, reason: 'cooldown' })
    // ...but a different play is its own notification.
    expect(second.dispatched).toBe(true)
    expect(second.sourceKey).toContain('pbp:G:88:TOUCHDOWN')
    expect(h.dispatch).toHaveBeenCalledTimes(1)
  })

  it('control: events without a play key keep their old source key shape', async () => {
    h.findMany.mockResolvedValue([])
    const res = await ingest({ ...play('x'), meta: { playerId: '101', playerName: 'Ashton Jeanty' } })
    expect(res.sourceKey).toBe('live_score_swing:101:Ashton Jeanty')
  })
})

describe('push tag', () => {
  it('uses the caller\'s per-event tag, else one per category and league', () => {
    expect(pushTagFor('matchup_results', { pushTag: 'live-play:pbp:G:88:TOUCHDOWN:subject' })).toBe(
      'live-play:pbp:G:88:TOUCHDOWN:subject',
    )
    expect(pushTagFor('matchup_results', { leagueId: 'lg1' })).toBe('notif-matchup_results-lg1')
    expect(pushTagFor('matchup_results', null)).toBe('notif-matchup_results-global')
    expect(pushTagFor('matchup_results', { pushTag: '   ' })).toBe('notif-matchup_results-global')
  })

  it('the DISPATCHER uses it, so the tag is not decorative', () => {
    // Call-site token, not a comment: a helper nothing calls protects nothing.
    const src = readFileSync(join(process.cwd(), 'lib/notifications/NotificationDispatcher.ts'), 'utf8')
    expect(src).toContain('tag: pushTagFor(category, meta)')
  })
})
