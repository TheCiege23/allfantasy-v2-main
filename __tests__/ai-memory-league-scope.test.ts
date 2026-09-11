import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ── `getFullAIContext`: the user filter that disappeared ─────────────────────────────────────
 *
 * 🛑 `getRecentMemoryEvents` APPLIES `where.userId` ONLY `if (options.userId)`. `getFullAIContext`
 * passed `userProfile?.userId`, and `userProfile` is null whenever the caller has no
 * `AIUserProfile` row — a new account, or any user reached by `userId` before a profile is
 * written. The filter then vanished and the query degraded to `where: { leagueId }`, returning
 * the ten most recent `AIMemoryEvent` rows for EVERY member of the league. `content` is
 * free-form per-user JSON and the result reaches the model through `buildMemoryPromptSection`.
 *
 * ⚠ THIS IS A DIFFERENT CATEGORY FROM `getTeamSnapshots`, AND THE DISTINCTION IS THE WHOLE POINT.
 * A team snapshot is derived roster analytics — win-now, future value, QB stability, RB
 * dependency, pick inventory — computed from facts every league member can already see. Reading
 * an opponent's snapshot inside your own league is what opponent analysis IS, and it is
 * deliberately left working; the last test here asserts exactly that.
 *
 * ⚠ AND THIS SUITE EXISTS AS ITS OWN FILE FOR A REASON. `chimmy-reader-authorization` mocks
 * `@/lib/ai-memory` wholesale, so the real function never runs there and no assertion in that
 * file could ever have observed this. A mocked module hides every path through it.
 */

const aiUserProfileFindUnique = vi.fn()
const aiUserProfileFindFirst = vi.fn()
const aiLeagueContextFindUnique = vi.fn()
const aiTeamStateSnapshotFindMany = vi.fn()
const aiMemoryEventFindMany = vi.fn()
const userFeedbackFindMany = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    aIUserProfile: { findUnique: aiUserProfileFindUnique, findFirst: aiUserProfileFindFirst },
    aILeagueContext: { findUnique: aiLeagueContextFindUnique },
    aITeamStateSnapshot: { findMany: aiTeamStateSnapshotFindMany },
    aIMemoryEvent: { findMany: aiMemoryEventFindMany },
    aIUserFeedback: { findMany: userFeedbackFindMany },
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  aiUserProfileFindUnique.mockResolvedValue(null)
  aiUserProfileFindFirst.mockResolvedValue(null)
  aiLeagueContextFindUnique.mockResolvedValue(null)
  aiTeamStateSnapshotFindMany.mockResolvedValue([])
  aiMemoryEventFindMany.mockResolvedValue([])
  userFeedbackFindMany.mockResolvedValue([])
})

/** The `where` handed to the memory-event query on the single call it makes, or null. */
function memoryEventWhere(): Record<string, unknown> | null {
  const call = aiMemoryEventFindMany.mock.calls[0]
  return call ? (call[0]?.where ?? null) : null
}

describe('getFullAIContext scopes memory events to one user', () => {
  it('🛑 a caller with NO AIUserProfile row still gets a userId filter', async () => {
    /*
     * The exact condition that removed it. Before the fix this produced `where: { leagueId }`
     * with no `userId` key at all — every member's events, in one league-wide read.
     */
    const { getFullAIContext } = await import('@/lib/ai-memory')
    aiUserProfileFindUnique.mockResolvedValue(null)
    await getFullAIContext({ userId: 'user-1', leagueId: 'league-1' })

    const where = memoryEventWhere()
    expect(where).not.toBeNull()
    expect(where).toMatchObject({ userId: 'user-1', leagueId: 'league-1' })
  })

  it('🛑 the query is NEVER league-only — that shape is the disclosure', async () => {
    /*
     * Asserted as the absence of the bad SHAPE rather than the presence of the good one, because
     * that is the property: a `where` carrying `leagueId` and no `userId` returns other people's
     * rows regardless of what else is right.
     */
    const { getFullAIContext } = await import('@/lib/ai-memory')
    aiUserProfileFindUnique.mockResolvedValue(null)
    await getFullAIContext({ userId: 'user-1', leagueId: 'league-1' })

    const where = memoryEventWhere() ?? {}
    const leagueScoped = 'leagueId' in where
    const userScoped = 'userId' in where && Boolean((where as { userId?: unknown }).userId)
    expect(leagueScoped && !userScoped).toBe(false)
  })

  it('✅ CONTROL: with a profile present it still scopes to that user', async () => {
    const { getFullAIContext } = await import('@/lib/ai-memory')
    aiUserProfileFindUnique.mockResolvedValue({ userId: 'user-1', sleeperUsername: 'ciege' })
    await getFullAIContext({ userId: 'user-1', leagueId: 'league-1' })
    expect(memoryEventWhere()).toMatchObject({ userId: 'user-1' })
  })

  it('✅ CONTROL: the sleeperUsername path still resolves and scopes', async () => {
    /*
     * Reached with no `userId` at all, so the fix must fall back to the profile's id rather than
     * refusing. If this goes red the narrowing was too aggressive.
     */
    const { getFullAIContext } = await import('@/lib/ai-memory')
    aiUserProfileFindFirst.mockResolvedValue({ userId: 'user-from-sleeper', sleeperUsername: 'ciege' })
    await getFullAIContext({ sleeperUsername: 'ciege', leagueId: 'league-1' })
    expect(memoryEventWhere()).toMatchObject({ userId: 'user-from-sleeper' })
  })

  it('🛑 with NO resolvable identity it reads nothing rather than everything', async () => {
    /*
     * An anonymous caller has no events of their own. The honest answer is an empty section; the
     * pre-fix answer was the league's. Asserting the query never runs is stronger than asserting
     * its result is empty.
     */
    const { getFullAIContext } = await import('@/lib/ai-memory')
    aiUserProfileFindUnique.mockResolvedValue(null)
    aiUserProfileFindFirst.mockResolvedValue(null)
    const ctx = await getFullAIContext({ leagueId: 'league-1' })
    expect(aiMemoryEventFindMany).not.toHaveBeenCalled()
    expect(ctx.recentEvents).toEqual([])
  })

  it('✅ CONTROL: opponent analysis is UNTOUCHED — team snapshots still read', async () => {
    /*
     * The half that must keep working. `getTeamSnapshots` is league-visible derived analytics,
     * and its prisma filter is compound — `{ leagueId, teamId }` — so a foreign team inside an
     * authorized league matches no rows without anything being disabled. If this goes red the
     * fix has broken the feature it was supposed to leave alone.
     */
    const { getFullAIContext } = await import('@/lib/ai-memory')
    aiUserProfileFindUnique.mockResolvedValue({ userId: 'user-1' })
    await getFullAIContext({ userId: 'user-1', leagueId: 'league-1', teamId: 'team-9' })
    expect(aiTeamStateSnapshotFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { leagueId: 'league-1', teamId: 'team-9' } }),
    )
  })
})
