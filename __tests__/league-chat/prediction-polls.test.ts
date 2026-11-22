import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  PREDICTION_POLL_SUBTYPE,
  applyPredictionResolution,
  buildPredictionPollMetadata,
  computePredictionLeaderboard,
  createPredictionPoll,
  decidePredictionOutcome,
  predictionPollMessageId,
  readPrediction,
  resolvePredictionPollsForLeague,
} from '@/lib/league-chat/predictionPolls'
import { readViewerPoll, redactPollForViewer } from '@/lib/chat-core/messagePolls'
import { sanitizeClientMessageMetadata } from '@/lib/chat-core/clientMessageInput'

const createLeagueChatMessageMock = vi.fn()
vi.mock('@/lib/league-chat/LeagueChatMessageService', () => ({
  createLeagueChatMessage: (...args: unknown[]) => createLeagueChatMessageMock(...args),
}))

const MATCHUP = {
  id: 'mu1',
  leagueId: 'l1',
  seasonId: 's1',
  week: 5,
  status: 'scheduled',
  homeRosterId: 'rH',
  awayRosterId: 'rA',
  homeScore: 0,
  awayScore: 0,
  isMedianMatchup: false,
}

function predictionMetadata(votes: { home?: string[]; away?: string[] } = {}, season = 2026) {
  const meta = buildPredictionPollMetadata({
    matchup: MATCHUP,
    season,
    home: { rosterId: 'rH', name: 'Hawks' },
    away: { rosterId: 'rA', name: 'Owls' },
    closeAt: new Date('2026-10-08T00:15:00Z'),
  })
  const options = meta.poll.options as Array<{ id: string; votes: string[] }>
  options[0].votes = votes.home ?? []
  options[1].votes = votes.away ?? []
  return meta as Record<string, unknown>
}

describe('building a prediction poll', () => {
  it('has the two teams as its only options and closes at kickoff', () => {
    const meta = predictionMetadata()
    const poll = meta.poll as Record<string, unknown>
    expect((poll.options as Array<{ text: string }>).map((o) => o.text)).toEqual(['Hawks', 'Owls'])
    expect(poll.closeAt).toBe('2026-10-08T00:15:00.000Z')
    expect(poll.allowMultiple).toBe(false)
    expect(poll.anonymous).toBe(false)
    expect(readPrediction(meta)?.matchupId).toBe('mu1')
  })

  it('a client cannot forge a prediction — the sanitizer drops it but keeps resultsVisibility', () => {
    const forged = predictionMetadata({ home: ['u9'] })
    ;(forged.poll as Record<string, unknown>).resultsVisibility = 'after_close'
    const clean = sanitizeClientMessageMetadata(forged) as Record<string, Record<string, unknown>>
    expect(clean.poll.prediction).toBeUndefined()
    expect(clean.poll.resultsVisibility).toBe('after_close')
    expect((clean.poll.options as Array<{ votes: string[] }>)[0].votes).toEqual([])
  })
})

describe('resolving on a final score', () => {
  it('decides nothing until the matchup is final', () => {
    expect(decidePredictionOutcome({ status: 'active', homeScore: 90, awayScore: 80 })).toBeNull()
    expect(decidePredictionOutcome({ status: 'final', homeScore: 90, awayScore: 80 })).toBe('home')
    expect(decidePredictionOutcome({ status: 'final', homeScore: 70, awayScore: 80 })).toBe('away')
    expect(decidePredictionOutcome({ status: 'final', homeScore: 80, awayScore: 80 })).toBe('tie')
  })

  it('writes the winner and closes the poll, then is a no-op the second time', () => {
    const now = new Date('2026-10-14T12:00:00Z')
    const once = applyPredictionResolution(predictionMetadata(), 'away', { home: 70, away: 80 }, now)
    expect(once).not.toBeNull()
    const poll = once!.poll as Record<string, unknown>
    expect(poll.closed).toBe(true)
    expect(readPrediction(once)?.winningOptionId).toBe('away-rA')
    expect(applyPredictionResolution(once, 'away', { home: 70, away: 80 }, now)).toBeNull()
  })

  it('follows a stat correction that flips the winner', () => {
    const now = new Date('2026-10-14T12:00:00Z')
    const first = applyPredictionResolution(predictionMetadata(), 'away', { home: 70, away: 80 }, now)
    const corrected = applyPredictionResolution(first, 'home', { home: 85, away: 80 }, now)
    expect(readPrediction(corrected)?.winningOptionId).toBe('home-rH')
  })

  it('the league resolver updates final matchups once and is idempotent', async () => {
    const store = new Map<string, unknown>([['p1', predictionMetadata({ home: ['u1'], away: ['u2'] })]])
    const db = {
      leagueChatMessage: {
        findMany: vi.fn(async () => [...store].map(([id, metadata]) => ({ id, metadata }))),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: { metadata: unknown } }) => {
          store.set(where.id, data.metadata)
          return {}
        }),
      },
      redraftMatchup: {
        findMany: vi.fn(async () => [{ id: 'mu1', status: 'final', homeScore: 101.5, awayScore: 99 }]),
      },
    }
    const first = await resolvePredictionPollsForLeague({ prisma: db as never, leagueId: 'l1' })
    expect(first.resolved).toBe(1)
    expect(db.leagueChatMessage.findMany.mock.calls[0][0].where).toEqual({
      leagueId: 'l1',
      messageSubtype: PREDICTION_POLL_SUBTYPE,
    })
    const second = await resolvePredictionPollsForLeague({ prisma: db as never, leagueId: 'l1' })
    expect(second.resolved).toBe(0)
    expect(db.leagueChatMessage.update).toHaveBeenCalledTimes(1)
  })

  it('leaves an unfinished matchup open', async () => {
    const db = {
      leagueChatMessage: {
        findMany: vi.fn(async () => [{ id: 'p1', metadata: predictionMetadata() }]),
        update: vi.fn(),
      },
      redraftMatchup: { findMany: vi.fn(async () => [{ id: 'mu1', status: 'active', homeScore: 10, awayScore: 5 }]) },
    }
    await resolvePredictionPollsForLeague({ prisma: db as never, leagueId: 'l1' })
    expect(db.leagueChatMessage.update).not.toHaveBeenCalled()
  })
})

describe('the Prediction Leaderboard', () => {
  const now = new Date('2026-10-14T12:00:00Z')
  const resolved = (votes: { home?: string[]; away?: string[] }, outcome: 'home' | 'away' | 'tie', season = 2026) =>
    applyPredictionResolution(predictionMetadata(votes, season), outcome, { home: 1, away: outcome === 'tie' ? 1 : 2 }, now)!

  it('gives one point per correct pick and counts every pick made', () => {
    const board = computePredictionLeaderboard(
      [
        { metadata: resolved({ home: ['u1'], away: ['u2', 'u3'] }, 'away') },
        { metadata: resolved({ home: ['u1', 'u2'], away: ['u3'] }, 'home') },
      ],
      2026,
    )
    const by = Object.fromEntries(board.map((b) => [b.userId, b]))
    expect(by.u1).toMatchObject({ points: 1, made: 2 })
    expect(by.u2).toMatchObject({ points: 2, made: 2 })
    expect(by.u3).toMatchObject({ points: 1, made: 2 })
    expect(board[0].userId).toBe('u2')
  })

  it('ignores unresolved polls, other seasons, and pays nothing on a tie', () => {
    const board = computePredictionLeaderboard(
      [
        { metadata: predictionMetadata({ home: ['u1'] }) },
        { metadata: resolved({ home: ['u1'] }, 'home', 2025) },
        { metadata: resolved({ home: ['u2'] }, 'tie') },
      ],
      2026,
    )
    expect(board).toEqual([{ userId: 'u2', points: 0, made: 1 }])
  })

  it('resolving twice does not double anybody', () => {
    const once = resolved({ home: ['u1'] }, 'home')
    const twice = applyPredictionResolution(once, 'home', { home: 1, away: 2 }, now) ?? once
    expect(computePredictionLeaderboard([{ metadata: twice }], 2026)).toEqual([{ userId: 'u1', points: 1, made: 1 }])
  })
})

describe('results after close', () => {
  const meta = () => {
    const m = predictionMetadata({ home: ['u1', 'u2'], away: ['u3'] })
    ;(m.poll as Record<string, unknown>).resultsVisibility = 'after_close'
    return m
  }
  const open = Date.parse('2026-10-07T00:00:00Z')
  const after = Date.parse('2026-10-09T00:00:00Z')

  it('redacts everyone else’s votes while open, keeping the viewer’s own', () => {
    const red = redactPollForViewer(meta(), 'u1', open)
    const poll = readViewerPoll(red, 'u1')!
    expect(poll.resultsHidden).toBe(true)
    expect(poll.totalVotes).toBe(1)
    expect(poll.options[0].mine).toBe(true)
    expect(JSON.stringify(red)).not.toContain('u2')
    expect(JSON.stringify(red)).not.toContain('u3')
  })

  it('shows the full tally once the deadline has passed', () => {
    const poll = readViewerPoll(redactPollForViewer(meta(), 'u1', after), 'u1')!
    expect(poll.resultsHidden).toBe(false)
    expect(poll.totalVotes).toBe(3)
  })

  it('a live poll is never redacted', () => {
    const m = predictionMetadata({ home: ['u1', 'u2'] })
    expect(redactPollForViewer(m, 'u1', open)).toEqual(m)
  })
})

describe('creating a prediction poll', () => {
  const now = new Date('2026-10-07T00:00:00Z')
  function db(overrides: { platform?: string; existing?: boolean; status?: string } = {}) {
    return {
      league: { findUnique: vi.fn(async () => ({ platform: overrides.platform ?? 'manual' })) },
      redraftSeason: { findFirst: vi.fn(async () => ({ id: 's1', season: 2026, sport: 'NFL', currentWeek: 5 })) },
      redraftMatchup: {
        findUnique: vi.fn(async () => ({
          ...MATCHUP,
          status: overrides.status ?? 'scheduled',
          homeRoster: { teamName: 'Hawks', ownerName: 'A' },
          awayRoster: { teamName: null, ownerName: 'Bea' },
        })),
      },
      leagueChatMessage: {
        findUnique: vi.fn(async () => (overrides.existing ? { id: predictionPollMessageId('mu1') } : null)),
      },
      redraftRoster: {},
      sportsGame: {},
    }
  }

  beforeEach(() => {
    createLeagueChatMessageMock.mockReset()
    createLeagueChatMessageMock.mockResolvedValue({ id: 'x', senderName: 'Ann', senderAvatarUrl: null })
  })

  it('posts one server-built poll with a deterministic id and the prediction subtype', async () => {
    const afterPost = vi.fn()
    const res = await createPredictionPoll({
      prisma: db() as never,
      leagueId: 'l1',
      matchupId: 'mu1',
      authorUserId: 'u1',
      now,
      firstKickoff: async () => new Date('2026-10-08T00:15:00Z'),
      afterPost,
    })
    expect(res).toEqual({ ok: true, messageId: 'predpoll_mu1', created: true })
    const [leagueId, author, body, opts] = createLeagueChatMessageMock.mock.calls[0]
    expect([leagueId, author]).toEqual(['l1', 'u1'])
    expect(body).toContain('Hawks vs Bea')
    expect(opts).toMatchObject({ idempotencyKey: 'predpoll_mu1', messageSubtype: PREDICTION_POLL_SUBTYPE })
    expect(afterPost).toHaveBeenCalledOnce()
  })

  it('returns the existing poll instead of a duplicate', async () => {
    const res = await createPredictionPoll({
      prisma: db({ existing: true }) as never,
      leagueId: 'l1',
      matchupId: 'mu1',
      authorUserId: 'u2',
      now,
      firstKickoff: async () => null,
    })
    expect(res).toEqual({ ok: true, messageId: 'predpoll_mu1', created: false })
    expect(createLeagueChatMessageMock).not.toHaveBeenCalled()
  })

  it('refuses an imported league, a started matchup, and a past kickoff', async () => {
    const base = { leagueId: 'l1', matchupId: 'mu1', authorUserId: 'u1', now }
    expect(await createPredictionPoll({ ...base, prisma: db({ platform: 'sleeper' }) as never })).toEqual({
      ok: false,
      code: 'not_native',
    })
    expect(
      await createPredictionPoll({ ...base, prisma: db({ status: 'active' }) as never, firstKickoff: async () => null }),
    ).toEqual({ ok: false, code: 'not_predictable' })
    expect(
      await createPredictionPoll({
        ...base,
        prisma: db() as never,
        firstKickoff: async () => new Date('2026-10-06T00:00:00Z'),
      }),
    ).toEqual({ ok: false, code: 'kicked_off' })
    expect(createLeagueChatMessageMock).not.toHaveBeenCalled()
  })
})
