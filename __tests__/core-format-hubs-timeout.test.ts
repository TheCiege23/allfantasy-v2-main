// @vitest-environment node
/**
 * Guards the failure path added to lib/core-app/formatHubs.ts.
 *
 * The /core render is force-dynamic and reads a cross-region database, so a read
 * that stalls used to hold the whole screen open with nothing painted — the hub
 * that was still on its skeleton 27 minutes after the click. Every read now has
 * a deadline: the membership read rejects (the page turns that into its "could
 * not read your leagues" panel), and a guarded read degrades to a partial hub.
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
})
