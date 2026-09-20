// @vitest-environment node
/**
 * Guards the failure path in lib/core-app/formatHubs.ts.
 *
 * The /core render is force-dynamic, so a read that stalls used to hold the whole
 * screen open with nothing painted — the hub still on its skeleton 27 minutes
 * after the click. Every read now has a deadline: the membership read rejects
 * (the page turns that into its "could not read your leagues" panel), and a
 * guarded read degrades to a partial hub.
 *
 * ⚠ THE ORIGINAL VERSION OF THIS NOTE BLAMED A CROSS-REGION DATABASE. The app and
 * the database sat on opposite coasts until 2026-09-09 and both are in Virginia
 * now, so that is not why this exists. A query can hang on pool exhaustion, a
 * lock, or a dropped connection at any distance — the point is that an unbounded
 * await has no failure mode at all.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const league = { findMany: vi.fn() }
const guillotineLeagueConfig = { findMany: vi.fn() }
const c2CLeague = { findMany: vi.fn() }
const zombieLeague = { findMany: vi.fn() }
const survivorGameState = { findMany: vi.fn() }
const tournamentLeague = { findMany: vi.fn() }
const guillotineRosterState = { findMany: vi.fn() }
const guillotinePeriodScore = { groupBy: vi.fn() }
const leagueChatMessage = { findMany: vi.fn() }

vi.mock('@/lib/prisma', () => ({
  // Arrow delegates so the factory (hoisted above the consts) reads them at call
  // time, not while it is still evaluating.
  prisma: {
    league: { findMany: (...a: unknown[]) => league.findMany(...a) },
    guillotineLeagueConfig: { findMany: (...a: unknown[]) => guillotineLeagueConfig.findMany(...a) },
    c2CLeague: { findMany: (...a: unknown[]) => c2CLeague.findMany(...a) },
    zombieLeague: { findMany: (...a: unknown[]) => zombieLeague.findMany(...a) },
    survivorGameState: { findMany: (...a: unknown[]) => survivorGameState.findMany(...a) },
    tournamentLeague: { findMany: (...a: unknown[]) => tournamentLeague.findMany(...a) },
    guillotineRosterState: { findMany: (...a: unknown[]) => guillotineRosterState.findMany(...a) },
    guillotinePeriodScore: { groupBy: (...a: unknown[]) => guillotinePeriodScore.groupBy(...a) },
    leagueChatMessage: { findMany: (...a: unknown[]) => leagueChatMessage.findMany(...a) },
  },
}))
vi.mock('@/lib/commissioner-os/profile/templatePin', () => ({
  readCommissionerTemplatePin: () => null,
}))
vi.mock('@/lib/core-app/tradesBoard', () => ({
  getTradesBoard: vi.fn().mockResolvedValue({ pending: [], windows: [] }),
}))
vi.mock('@/lib/core-app/currentWeek', () => ({
  resolveCurrentWeek: vi.fn().mockResolvedValue(null),
}))

import { getFormatHub } from '@/lib/core-app/formatHubs'

const NEVER = () => new Promise(() => {})

const guillotineMember = {
  id: 'lg-1',
  name: 'The Chopping Block',
  platform: 'sleeper',
  platformLeagueId: 'plat-1',
  leagueSize: 10,
  userId: 'user-1',
  leagueType: 'guillotine',
  guillotineMode: true,
  lastSyncedAt: null,
  syncStatus: null,
}

beforeEach(() => {
  vi.useFakeTimers()
  for (const m of [
    league,
    guillotineLeagueConfig,
    c2CLeague,
    zombieLeague,
    survivorGameState,
    tournamentLeague,
    guillotineRosterState,
    leagueChatMessage,
  ]) {
    m.findMany.mockReset().mockResolvedValue([])
  }
  guillotinePeriodScore.groupBy.mockReset().mockResolvedValue([])
})

afterEach(() => {
  vi.useRealTimers()
})

describe('getFormatHub failure path', () => {
  it('rejects instead of hanging when the membership read never returns', async () => {
    league.findMany.mockImplementationOnce(NEVER)

    const promise = getFormatHub('user-1', 'guillotine')
    const settled = promise.then(
      () => 'resolved',
      () => 'rejected',
    )

    await vi.advanceTimersByTimeAsync(8_000)
    await expect(settled).resolves.toBe('rejected')
  })

  it('returns a partial hub when a guarded read never returns', async () => {
    // Members resolves; the guillotine detection read hangs.
    league.findMany.mockResolvedValueOnce([guillotineMember])
    guillotineLeagueConfig.findMany.mockImplementationOnce(NEVER)

    const promise = getFormatHub('user-1', 'guillotine')

    // Let every deadline elapse, then drain the follow-up reads.
    await vi.advanceTimersByTimeAsync(8_000)
    const data = await promise

    expect(data.partial).toBe(true)
    expect(data.format).toBe('guillotine')
    expect(data.totalLeagues).toBe(1)
  })

  it('leaves no deadline timer pending when every read is fast', async () => {
    /*
     * 🛑 `Promise.race` SETTLES ON THE WINNER AND DOES NOT CANCEL THE LOSER. Without the `finally`
     * that clears it, every single guarded read — on every hub render, for every user — would
     * leave an 8-second timer alive after returning. Nothing would fail; the process would just
     * hold timers it has no use for, and under fake timers a suite would hang waiting for them.
     *
     * This is the case the deadline's own happy path never exercises, which is why it is asserted
     * separately rather than inferred from the two failure tests above.
     */
    league.findMany.mockResolvedValueOnce([guillotineMember])

    const before = vi.getTimerCount()
    await getFormatHub('user-1', 'guillotine')

    expect(vi.getTimerCount()).toBe(before)
  })
})
