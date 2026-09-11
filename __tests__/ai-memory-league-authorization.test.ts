/**
 * `getFullAIContext` — a `leagueId` is only honoured when the viewer is in it.
 *
 * 🛑 THE ID ARRIVES FROM A REQUEST BODY. Traced 2026-09-11 from
 * `app/api/chat/chimmy/route.ts`: `leagueId` comes off the form, and the route
 * refuses an unauthorized one ONLY when the question is classified as needing
 * league grounding. For every other question the id is never nulled, flows into
 * `planInput`, and reaches this function — where three reads were keyed on it
 * with no viewer column.
 *
 * ⚠ THE ROUTE'S OWN FIX DID NOT REACH HERE, WHICH IS WHY THIS IS ITS OWN SUITE.
 * Sixteen grounding builders in that route are gated on the authorized
 * `leagueSnapshot`, which is null when grounding fails. This function never sees
 * the snapshot — it takes the raw id — so it sat outside that gate.
 *
 * 🛑 THE FIRST DESCRIBE IS A PRECONDITION. Every "it was not read" assertion
 * below is worthless if the function bailed earlier for an unrelated reason, and
 * the sibling Chimmy suites are on record going 15/15 green over a live bypass
 * for exactly that reason. So each refusal is paired with a test proving the
 * SAME call shape DOES reach the read when the viewer is a member.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const mocks = vi.hoisted(() => ({
  resolveLeagueMembership: vi.fn(),
  profileFindUnique: vi.fn(),
  profileFindFirst: vi.fn(),
  leagueContextFindUnique: vi.fn(),
  snapshotFindMany: vi.fn(),
  eventFindMany: vi.fn(),
  feedbackFindMany: vi.fn(),
}))

vi.mock('@/lib/league-access', () => ({ resolveLeagueMembership: mocks.resolveLeagueMembership }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    aIUserProfile: { findUnique: mocks.profileFindUnique, findFirst: mocks.profileFindFirst },
    aILeagueContext: { findUnique: mocks.leagueContextFindUnique },
    aITeamStateSnapshot: { findMany: mocks.snapshotFindMany },
    aIMemoryEvent: { findMany: mocks.eventFindMany },
    aIUserFeedback: { findMany: mocks.feedbackFindMany },
  },
}))
vi.mock('@/lib/ai-personality', () => ({
  UserToneSettings: {},
  DEFAULT_TONE_SETTINGS: {},
}))

import { getFullAIContext } from '@/lib/ai-memory'

const VIEWER = 'app-user-uuid-viewer'
const MY_LEAGUE = 'league-i-am-in'
const THEIR_LEAGUE = 'league-i-am-not-in'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveLeagueMembership.mockResolvedValue({ ok: true, leagueId: MY_LEAGUE })
  mocks.profileFindUnique.mockResolvedValue({ userId: VIEWER, sleeperUsername: 'v' })
  mocks.profileFindFirst.mockResolvedValue(null)
  mocks.leagueContextFindUnique.mockResolvedValue({ leagueId: MY_LEAGUE, notes: 'x' })
  mocks.snapshotFindMany.mockResolvedValue([])
  mocks.eventFindMany.mockResolvedValue([])
  mocks.feedbackFindMany.mockResolvedValue([])
})

describe('PRECONDITION — the reads this suite guards are reachable', () => {
  it('reads the league context for a member, keyed on the id passed in', async () => {
    /*
     * 🛑 WITHOUT THIS, EVERY `not.toHaveBeenCalled()` BELOW IS VACUOUS.
     */
    await getFullAIContext({ userId: VIEWER, leagueId: MY_LEAGUE })
    expect(
      mocks.leagueContextFindUnique,
      'the league read was never reached — the refusal assertions would be vacuous',
    ).toHaveBeenCalledWith({ where: { leagueId: MY_LEAGUE } })
  })

  it('reads team snapshots for a member when a teamId is given', async () => {
    await getFullAIContext({ userId: VIEWER, leagueId: MY_LEAGUE, teamId: 'team-1' })
    expect(mocks.snapshotFindMany).toHaveBeenCalled()
  })

  it('consults the membership resolver with the caller as the viewer', async () => {
    await getFullAIContext({ userId: VIEWER, leagueId: MY_LEAGUE })
    expect(mocks.resolveLeagueMembership).toHaveBeenCalledWith(MY_LEAGUE, VIEWER)
  })
})

describe('refuses a league the viewer is not in', () => {
  beforeEach(() => {
    mocks.resolveLeagueMembership.mockResolvedValue({ ok: false, reason: 'not_member', status: 403 })
  })

  it('does not read the league context', async () => {
    const ctx = await getFullAIContext({ userId: VIEWER, leagueId: THEIR_LEAGUE })
    expect(mocks.leagueContextFindUnique, 'a non-member read the league context').not.toHaveBeenCalled()
    expect(ctx.leagueContext).toBeNull()
  })

  it('does not read team snapshots even when a teamId is supplied', async () => {
    const ctx = await getFullAIContext({ userId: VIEWER, leagueId: THEIR_LEAGUE, teamId: 'team-1' })
    expect(mocks.snapshotFindMany, 'a non-member read team snapshots').not.toHaveBeenCalled()
    expect(ctx.teamSnapshots).toEqual([])
  })

  it('does not let the unauthorized id into the memory-event query', async () => {
    await getFullAIContext({ userId: VIEWER, leagueId: THEIR_LEAGUE })
    const where = mocks.eventFindMany.mock.calls[0]?.[0]?.where ?? {}
    expect(where.leagueId, 'an unauthorized leagueId reached the event query').toBeUndefined()
    expect(where.userId, 'the event query lost its viewer filter').toBe(VIEWER)
  })

  it('fails closed when there is no viewer to prove membership with', async () => {
    /*
     * ⚠ NO `userId` MEANS MEMBERSHIP CANNOT BE PROVED, NOT THAT IT IS WAIVED.
     * The function also accepts `sleeperUsername`, and resolving a profile from
     * one does not establish that the caller may see a league.
     */
    mocks.profileFindUnique.mockResolvedValue(null)
    mocks.profileFindFirst.mockResolvedValue({ userId: 'someone-else', sleeperUsername: 'sleeper-name' })
    const ctx = await getFullAIContext({ sleeperUsername: 'sleeper-name', leagueId: THEIR_LEAGUE })
    expect(mocks.resolveLeagueMembership).not.toHaveBeenCalled()
    expect(mocks.leagueContextFindUnique).not.toHaveBeenCalled()
    expect(ctx.leagueContext).toBeNull()
  })
})

describe('the memory-event query can never go unscoped', () => {
  it('never issues a query with no viewer filter', async () => {
    /*
     * 🛑 THE SILENTLY-OPTIONAL FILTER. `getRecentMemoryEvents` applies
     * `where.userId` only `if (options.userId)`, so a null profile used to make
     * the filter vanish — leaving a league-wide read over every user's memory
     * events, or with no league either, `where: {}`: the ten most recent memory
     * events in the system, for anyone. Nothing threw and the rows looked normal.
     */
    mocks.profileFindUnique.mockResolvedValue(null)
    mocks.profileFindFirst.mockResolvedValue(null)
    await getFullAIContext({ sleeperUsername: 'nobody' })
    if (mocks.eventFindMany.mock.calls.length) {
      const where = mocks.eventFindMany.mock.calls[0][0]?.where ?? {}
      expect(Object.keys(where).length, 'an unscoped memory-event query was issued').toBeGreaterThan(0)
      expect(where.userId).toBeDefined()
    }
  })

  it('returns no events rather than everyone’s when there is no viewer', async () => {
    /*
     * ⚠ THE DATABASE MUST HAVE SOMETHING TO LEAK, OR THIS CANNOT FAIL. A first
     * version left `eventFindMany` returning `[]`, so `recentEvents` was empty
     * whether the query ran or not and the assertion held on the vulnerable
     * code too — caught by a mutation that removed the guard and left this test
     * green. The delegate now returns a row belonging to someone else.
     */
    mocks.profileFindUnique.mockResolvedValue(null)
    mocks.profileFindFirst.mockResolvedValue(null)
    mocks.eventFindMany.mockResolvedValue([
      { id: 'evt-1', userId: 'a-stranger', leagueId: THEIR_LEAGUE, eventType: 'note' },
    ])
    const ctx = await getFullAIContext({ sleeperUsername: 'nobody' })
    expect(mocks.eventFindMany, 'an unscoped memory-event query was issued').not.toHaveBeenCalled()
    expect(ctx.recentEvents).toEqual([])
  })
})
