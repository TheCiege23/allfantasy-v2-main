import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  findMany: vi.fn(), ingestBatch: vi.fn(),
  identityFind: vi.fn(), rawQuery: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftRosterPlayer: { findMany: h.findMany },
    playerIdentityMap: { findMany: h.identityFind },
    $queryRawUnsafe: h.rawQuery,
  },
}))
vi.mock('@/lib/notification-engine', () => ({ ingestBatch: h.ingestBatch }))

import { notifyBigPlays, notificationTitleFor } from '@/lib/live/bigPlayNotifier'
import type { LiveEvent } from '@/lib/live/eventDetector'

const ev = (over: Partial<LiveEvent> = {}): LiveEvent =>
  ({
    gameId: '20260920-1-26',
    playerId: '101',
    playerName: 'Bijan Robinson',
    team: 'ATL',
    type: 'BIG_PLAY',
    stat: 'rushing_yards',
    delta: 24,
    value: 88,
    detectedAt: new Date('2026-09-20T18:00:00Z'),
    idempotencyKey: '20260920-1-26:42:BIG_PLAY',
    ...over,
  }) as LiveEvent

const rostered = (playerId = '101', ownerId = 'user-1') => [
  { playerId, roster: { ownerId } },
]

beforeEach(() => {
  h.findMany.mockReset()
  h.ingestBatch.mockReset()
  h.findMany.mockResolvedValue(rostered())
  h.ingestBatch.mockResolvedValue([])
  h.identityFind.mockReset(); h.identityFind.mockResolvedValue([])
  h.rawQuery.mockReset(); h.rawQuery.mockResolvedValue([])
})

describe('who gets told', () => {
  it('notifies only the managers who roster the player', async () => {
    // The whole feature. An alert for every 20-yard run in the league is a
    // notification every few seconds on a Sunday, which trains people to mute.
    const res = await notifyBigPlays([ev()])
    expect(res.notificationsSent).toBe(1)
    expect(h.ingestBatch.mock.calls[0][0][0].userIds).toEqual(['user-1'])
  })

  it('sends nothing when nobody rosters the player', async () => {
    h.findMany.mockResolvedValue([])
    const res = await notifyBigPlays([ev()])
    expect(res.skipped).toBe('no-rosters')
    expect(h.ingestBatch).not.toHaveBeenCalled()
  })

  it('excludes dropped players and inactive seasons at the query', async () => {
    await notifyBigPlays([ev()])
    const where = h.findMany.mock.calls[0][0].where
    // A dropped player keeps his row until droppedAt is set — without this a
    // manager hears about someone they cut last week.
    expect(where.droppedAt).toBeNull()
    expect(where.roster.season.status).toBe('active')
  })

  it('tells a manager once even when they hold the player in several leagues', async () => {
    h.findMany.mockResolvedValue([
      { playerId: '101', roster: { ownerId: 'user-1' } },
      { playerId: '101', roster: { ownerId: 'user-1' } },
      { playerId: '101', roster: { ownerId: 'user-2' } },
    ])
    await notifyBigPlays([ev()])
    expect(h.ingestBatch.mock.calls[0][0][0].userIds).toEqual(['user-1', 'user-2'])
  })
})

describe('the correction guard', () => {
  it('NEVER alerts on a negative delta', async () => {
    // A cumulative stat going down is a stat correction, not a play. The vendor
    // reprocesses for ~12h after a game and ships no correction flag, so a
    // revision is indistinguishable from a new event except by its sign.
    const res = await notifyBigPlays([ev({ delta: -24 })])
    expect(res.eventsAlertable).toBe(0)
    expect(h.ingestBatch).not.toHaveBeenCalled()
  })

  it('still alerts on a genuine zero-yard touchdown', async () => {
    // A 0-yard plunge is a real touchdown. Only NEGATIVE means correction.
    const res = await notifyBigPlays([ev({ type: 'TOUCHDOWN', delta: 0 })])
    expect(res.notificationsSent).toBe(1)
  })
})

describe('what is worth interrupting a Sunday for', () => {
  it('covers the plays a manager actually wants', async () => {
    for (const type of ['TOUCHDOWN', 'BIG_PLAY', 'DEFENSIVE_SCORE', 'SPECIAL_TEAMS_SCORE', 'TURNOVER'] as const) {
      h.ingestBatch.mockClear()
      const res = await notifyBigPlays([ev({ type })])
      expect(res.notificationsSent, `${type} should alert`).toBe(1)
    }
  })

  it('does NOT alert on a field goal', async () => {
    // Real event, bad notification: the kicker's owner cares, nobody else does,
    // and it fires several times a game.
    const res = await notifyBigPlays([ev({ type: 'FIELD_GOAL' })])
    expect(res.eventsAlertable).toBe(0)
  })

  it('wakes you for a touchdown, not for a 21-yard catch', async () => {
    await notifyBigPlays([ev({ type: 'TOUCHDOWN' })])
    expect(h.ingestBatch.mock.calls[0][0][0].severity).toBe('high')
    h.ingestBatch.mockClear()
    await notifyBigPlays([ev({ type: 'BIG_PLAY' })])
    expect(h.ingestBatch.mock.calls[0][0][0].severity).toBe('low')
  })
})

describe('the payload', () => {
  it('carries the idempotency key so an alert can be retracted', async () => {
    // Officiating reversals happen and the vendor ships no correction flag.
    // Without this key a later reversal cannot find the notification it needs
    // to correct, and the manager keeps believing an overturned touchdown.
    await notifyBigPlays([ev()])
    expect(h.ingestBatch.mock.calls[0][0][0].meta.idempotencyKey)
      .toBe('20260920-1-26:42:BIG_PLAY')
  })

  it('reads like a sentence, not a stat key', async () => {
    await notifyBigPlays([ev()])
    const n = h.ingestBatch.mock.calls[0][0][0]
    expect(n.title).toBe('Big play')
    expect(n.body).toContain('Bijan Robinson')
    expect(n.body).toContain('24')
  })

  it('never throws when the notification engine fails', async () => {
    h.ingestBatch.mockRejectedValue(new Error('queue down'))
    // This runs behind live scoring. A missed alert must not cost a score.
    await expect(notifyBigPlays([ev()])).resolves.toMatchObject({ notificationsSent: 0 })
  })

  it('is a no-op on an empty batch', async () => {
    await expect(notifyBigPlays([])).resolves.toMatchObject({ skipped: 'no-events' })
  })
})

describe('notificationTitleFor', () => {
  it('names each event the way a person would', () => {
    expect(notificationTitleFor(ev({ type: 'TOUCHDOWN' }))).toBe('Touchdown')
    expect(notificationTitleFor(ev({ type: 'DEFENSIVE_SCORE' }))).toBe('Defensive touchdown')
    expect(notificationTitleFor(ev({ type: 'SPECIAL_TEAMS_SCORE' }))).toBe('Special teams touchdown')
  })
})

describe('imported leagues', () => {
  it('notifies Sleeper managers, who outnumber redraft managers 4 to 1', async () => {
    // 205 redraft roster rows against 914 imported ones. Querying only the
    // first fires for a fifth of the league and looks broken to everyone else.
    h.findMany.mockResolvedValue([])
    h.identityFind.mockResolvedValue([{ rollingInsightsId: '101', sleeperId: '11560' }])
    h.rawQuery.mockResolvedValue([{ platformUserId: 'sleeper-user-9' }])

    const res = await notifyBigPlays([ev()])
    expect(res.notificationsSent).toBe(1)
    expect(h.ingestBatch.mock.calls[0][0][0].userIds).toEqual(['sleeper-user-9'])
  })

  it('crosses RI ids to Sleeper ids rather than assuming they match', async () => {
    h.identityFind.mockResolvedValue([{ rollingInsightsId: '101', sleeperId: '11560' }])
    h.rawQuery.mockResolvedValue([])
    await notifyBigPlays([ev()])
    // The feed speaks Rolling Insights ids; rosters hold Sleeper ids.
    expect(h.identityFind.mock.calls[0][0].where.rollingInsightsId.in).toEqual(['101'])
    expect(h.rawQuery.mock.calls[0][1]).toBe(JSON.stringify(['11560']))
  })

  it('skips a player with no identity row instead of guessing', async () => {
    h.findMany.mockResolvedValue([])
    h.identityFind.mockResolvedValue([])
    const res = await notifyBigPlays([ev()])
    expect(res.skipped).toBe('no-rosters')
    expect(h.rawQuery).not.toHaveBeenCalled()
  })

  it('still alerts redraft managers when the imported lookup fails', async () => {
    // Imported resolution is additive. A failure there must not mean nobody
    // gets an alert.
    h.identityFind.mockRejectedValue(new Error('db down'))
    const res = await notifyBigPlays([ev()])
    expect(res.notificationsSent).toBe(1)
    expect(h.ingestBatch.mock.calls[0][0][0].userIds).toEqual(['user-1'])
  })

  it('merges both league types for the same player without duplicates', async () => {
    h.findMany.mockResolvedValue(rostered('101', 'redraft-user'))
    h.identityFind.mockResolvedValue([{ rollingInsightsId: '101', sleeperId: '11560' }])
    h.rawQuery.mockResolvedValue([{ platformUserId: 'sleeper-user-9' }, { platformUserId: 'sleeper-user-9' }])
    await notifyBigPlays([ev()])
    expect(h.ingestBatch.mock.calls[0][0][0].userIds).toEqual(['redraft-user', 'sleeper-user-9'])
  })
})
