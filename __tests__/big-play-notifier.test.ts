import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  findMany: vi.fn(), ingestBatch: vi.fn(),
  identityFind: vi.fn(), rawQuery: vi.fn(), profileFind: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftRosterPlayer: { findMany: h.findMany },
    playerIdentityMap: { findMany: h.identityFind },
    userProfile: { findMany: h.profileFind },
    $queryRawUnsafe: h.rawQuery,
  },
}))
vi.mock('@/lib/notification-engine', () => ({ ingestBatch: h.ingestBatch }))

import { notifyBigPlays, notificationTitleFor, ownersByPlayerId } from '@/lib/live/bigPlayNotifier'
import type { LiveEvent } from '@/lib/live/eventDetector'

const ev = (over: Partial<LiveEvent> = {}): LiveEvent =>
  ({
    gameId: '20260920-1-26',
    playerId: '101',
    playerName: 'Bijan Robinson',
    team: 'ATL',
    type: 'BIG_PLAY',
    stat: 'run',
    role: 'rusher',
    delta: 24,
    value: 24,
    detectedAt: new Date('2026-09-20T18:00:00Z'),
    idempotencyKey: 'pbp:20260920-1-26:42:BIG_PLAY',
    ...over,
  }) as LiveEvent

// Redraft roster rows hold the SLEEPER id ('11560'), never the RI feed id ('101').
const rostered = (playerId = '11560', ownerId = 'user-1') => [
  { playerId, roster: { ownerId } },
]

beforeEach(() => {
  h.findMany.mockReset()
  h.ingestBatch.mockReset()
  h.findMany.mockResolvedValue(rostered())
  h.ingestBatch.mockResolvedValue([])
  h.identityFind.mockReset()
  h.identityFind.mockResolvedValue([{ rollingInsightsId: '101', sleeperId: '11560' }])
  h.rawQuery.mockReset(); h.rawQuery.mockResolvedValue([])
  h.profileFind.mockReset(); h.profileFind.mockResolvedValue([])
})

describe('who gets told', () => {
  it('notifies the managers starting the player', async () => {
    const res = await notifyBigPlays([ev()])
    expect(res.notificationsSent).toBe(1)
    expect(h.ingestBatch.mock.calls[0][0][0].userIds).toEqual(['user-1'])
  })

  it('sends nothing when nobody starts the player', async () => {
    h.findMany.mockResolvedValue([])
    const res = await notifyBigPlays([ev()])
    expect(res.skipped).toBe('no-rosters')
    expect(h.ingestBatch).not.toHaveBeenCalled()
  })

  it('STARTERS ONLY: bench, IR and taxi slots are excluded at the query, in both spellings', async () => {
    // User decision 2026-09-13: a benched player's touchdown scores nothing for you.
    await notifyBigPlays([ev()])
    const where = h.findMany.mock.calls[0][0].where
    expect(where.NOT.slotType.in).toEqual(expect.arrayContaining(['bench', 'BENCH', 'IR', 'TAXI']))
    // A dropped player keeps his row until droppedAt is set.
    expect(where.droppedAt).toBeNull()
    expect(where.roster.season.status).toBe('active')
    // ...and queries by the TRANSLATED Sleeper id, never the RI feed id.
    expect(where.playerId.in).toEqual(['11560'])
  })

  it('STARTERS ONLY on imported leagues too: the lineup array, not the whole roster', async () => {
    await notifyBigPlays([ev()])
    expect(h.rawQuery.mock.calls[0][0]).toContain(`->'starters'`)
    expect(h.rawQuery.mock.calls[0][0]).not.toContain(`->'players'`)
  })

  it('control: the injury importer still gets the whole roster by default', async () => {
    await ownersByPlayerId(['101'])
    expect(h.findMany.mock.calls[0][0].where.NOT).toBeUndefined()
    expect(h.rawQuery.mock.calls[0][0]).toContain(`->'players'`)
  })

  it('tells a manager once even when they start the player in several leagues', async () => {
    h.findMany.mockResolvedValue([
      { playerId: '11560', roster: { ownerId: 'user-1' } },
      { playerId: '11560', roster: { ownerId: 'user-1' } },
      { playerId: '11560', roster: { ownerId: 'user-2' } },
    ])
    await notifyBigPlays([ev()])
    expect(h.ingestBatch.mock.calls[0][0][0].userIds).toEqual(['user-1', 'user-2'])
  })
})

describe('a passing play is told to both ends', () => {
  const td = ev({
    type: 'TOUCHDOWN', stat: 'pass', role: 'receiver', delta: 34, value: 34,
    playerId: '101', playerName: 'Drake London', passerId: '202', passerName: 'Kirk Cousins',
    idempotencyKey: 'pbp:20260920-1-26:77:TOUCHDOWN',
  })

  beforeEach(() => {
    h.identityFind.mockResolvedValue([
      { rollingInsightsId: '101', sleeperId: '11560' },
      { rollingInsightsId: '202', sleeperId: '5000' },
    ])
    h.findMany.mockResolvedValue([
      { playerId: '11560', roster: { ownerId: 'user-wr' } },
      { playerId: '5000', roster: { ownerId: 'user-qb' } },
      // Starts both: hears it once, from the scorer's side.
      { playerId: '5000', roster: { ownerId: 'user-wr' } },
    ])
  })

  it("the receiver's managers and the passer's managers each get their own line", async () => {
    const res = await notifyBigPlays([td])
    expect(res.notificationsSent).toBe(2)
    const [receiver, passer] = h.ingestBatch.mock.calls[0][0]
    expect(receiver.userIds).toEqual(['user-wr'])
    expect(receiver.body).toBe('Drake London 34-yard receiving TD from Kirk Cousins')
    expect(passer.userIds).toEqual(['user-qb'])
    expect(passer.body).toBe('Kirk Cousins 34-yard TD pass to Drake London')
    // Looked up both players in one pass.
    expect(h.identityFind.mock.calls[0][0].where.rollingInsightsId.in).toEqual(['101', '202'])
  })

  it('each side is its own device notification', async () => {
    await notifyBigPlays([td])
    const [receiver, passer] = h.ingestBatch.mock.calls[0][0]
    expect(receiver.meta.pushTag).not.toBe(passer.meta.pushTag)
    expect(receiver.meta.playerId).toBe('101')
    expect(passer.meta.playerId).toBe('202')
  })
})

describe('the correction guard', () => {
  it('NEVER alerts on a negative delta', async () => {
    // A cumulative stat going down is a stat correction, not a play.
    const res = await notifyBigPlays([ev({ delta: -24 })])
    expect(res.eventsAlertable).toBe(0)
    expect(h.ingestBatch).not.toHaveBeenCalled()
  })

  it('still alerts on a genuine zero-yard touchdown', async () => {
    const res = await notifyBigPlays([ev({ type: 'TOUCHDOWN', delta: 0 })])
    expect(res.notificationsSent).toBe(1)
  })
})

describe('every score and every 20+ yard play', () => {
  it('covers every scoring type, big plays and turnovers', async () => {
    for (const type of ['TOUCHDOWN', 'BIG_PLAY', 'FIELD_GOAL', 'DEFENSIVE_SCORE', 'SPECIAL_TEAMS_SCORE', 'TURNOVER'] as const) {
      h.ingestBatch.mockClear()
      const res = await notifyBigPlays([ev({ type })])
      expect(res.notificationsSent, `${type} should alert`).toBe(1)
    }
  })

  it('a field goal is a score now (user decision 2026-09-13)', async () => {
    await notifyBigPlays([ev({ type: 'FIELD_GOAL', stat: 'field_goal', role: 'kicker' })])
    const n = h.ingestBatch.mock.calls[0][0][0]
    expect(n.title).toBe('Field goal')
    expect(n.severity).toBe('medium')
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
  it('carries the idempotency key so an alert can be retracted and a second TD is not collapsed', async () => {
    await notifyBigPlays([ev()])
    expect(h.ingestBatch.mock.calls[0][0][0].meta.idempotencyKey).toBe('pbp:20260920-1-26:42:BIG_PLAY')
  })

  it('names its own push tag, per play', async () => {
    await notifyBigPlays([ev(), ev({ idempotencyKey: 'pbp:20260920-1-26:55:BIG_PLAY' })])
    const [a, b] = h.ingestBatch.mock.calls[0][0]
    expect(a.meta.pushTag).toBe('live-play:pbp:20260920-1-26:42:BIG_PLAY:subject')
    expect(a.meta.pushTag).not.toBe(b.meta.pushTag)
  })

  it('reads like a sentence with the yardage, and opens Live Scores', async () => {
    await notifyBigPlays([ev()])
    const n = h.ingestBatch.mock.calls[0][0][0]
    expect(n.title).toBe('Big play')
    expect(n.body).toBe('Bijan Robinson 24-yard run')
    expect(n.actionHref).toBe('/core/live?sport=NFL')
  })

  it('never emails or texts a play — in-app + push only', async () => {
    await notifyBigPlays([ev()])
    expect(h.ingestBatch.mock.calls[0][0][0].skipChannels).toEqual({ email: true, sms: true })
  })

  it('never throws when the notification engine fails', async () => {
    h.ingestBatch.mockRejectedValue(new Error('queue down'))
    await expect(notifyBigPlays([ev()])).resolves.toMatchObject({ notificationsSent: 0 })
  })

  it('is a no-op on an empty batch', async () => {
    await expect(notifyBigPlays([])).resolves.toMatchObject({ skipped: 'no-events' })
  })
})

describe('notificationTitleFor', () => {
  it('names each event the way a person would', () => {
    expect(notificationTitleFor(ev({ type: 'TOUCHDOWN' }))).toBe('Touchdown')
    expect(notificationTitleFor(ev({ type: 'FIELD_GOAL' }))).toBe('Field goal')
    expect(notificationTitleFor(ev({ type: 'DEFENSIVE_SCORE' }))).toBe('Defensive touchdown')
    expect(notificationTitleFor(ev({ type: 'SPECIAL_TEAMS_SCORE' }))).toBe('Special teams touchdown')
  })
})

describe('imported leagues', () => {
  it('notifies Sleeper managers, who outnumber redraft managers 4 to 1', async () => {
    h.findMany.mockResolvedValue([])
    h.rawQuery.mockResolvedValue([{ platformUserId: 'sleeper-user-9' }])
    h.profileFind.mockResolvedValue([{ userId: 'af-user-9', sleeperUserId: 'sleeper-user-9' }])

    const res = await notifyBigPlays([ev()])
    expect(res.notificationsSent).toBe(1)
    // The Sleeper user id is translated to OUR user id.
    expect(h.ingestBatch.mock.calls[0][0][0].userIds).toEqual(['af-user-9'])
  })

  it('crosses RI ids to Sleeper ids rather than assuming they match', async () => {
    await notifyBigPlays([ev()])
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

  it('still alerts redraft managers when the imported roster lookup fails', async () => {
    h.rawQuery.mockRejectedValue(new Error('db down'))
    const res = await notifyBigPlays([ev()])
    expect(res.notificationsSent).toBe(1)
    expect(h.ingestBatch.mock.calls[0][0][0].userIds).toEqual(['user-1'])
  })

  it('merges both league types for the same player without duplicates', async () => {
    h.findMany.mockResolvedValue(rostered('11560', 'redraft-user'))
    h.rawQuery.mockResolvedValue([{ platformUserId: 'sleeper-user-9' }, { platformUserId: 'sleeper-user-9' }])
    h.profileFind.mockResolvedValue([{ userId: 'af-user-9', sleeperUserId: 'sleeper-user-9' }])
    await notifyBigPlays([ev()])
    expect(h.ingestBatch.mock.calls[0][0][0].userIds).toEqual(['redraft-user', 'af-user-9'])
  })
})
