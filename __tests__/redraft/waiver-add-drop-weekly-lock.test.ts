/**
 * Regression lock for a bug found during the NFL redraft Waivers UI rehearsal:
 * `assertWaiverClaimEligibility` (lib/waiver-wire/transaction-eligibility.ts) treated the
 * whole-roster `isLegal` flag from `evaluateLegalityForProjectedRoster` as blocking, but that
 * flag folds in the broad weekly lineup lock (e.g. `football_weekly`'s "Mon-Tue" window), which
 * exists to freeze STARTER edits during game windows — not to freeze bench-only free-agent
 * adds. A locked player specifically being dropped is already blocked precisely above via
 * `computePerPlayerKickoffLocks`. Before the fix, every free-agent add failed with
 * "Lineups stay locked Mon-Tue..." for ~2 of every 7 days, all season, regardless of whether the
 * move ever touched a starter slot.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const findFirstLeague = vi.fn()
const findFirstRoster = vi.fn()
const findManyRoster = vi.fn()
const leagueWaiverSettingsFindUnique = vi.fn()
const evaluateLegalityForProjectedRoster = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findFirst: (...args: unknown[]) => findFirstLeague(...args) },
    roster: {
      findFirst: (...args: unknown[]) => findFirstRoster(...args),
      findMany: (...args: unknown[]) => findManyRoster(...args),
    },
    leagueWaiverSettings: { findUnique: (...args: unknown[]) => leagueWaiverSettingsFindUnique(...args) },
  },
}))

vi.mock('@/lib/roster-legality/loadLegalityEvaluationContext', () => ({
  evaluateLegalityForProjectedRoster: (...args: unknown[]) => evaluateLegalityForProjectedRoster(...args),
}))

vi.mock('@/lib/waiver-wire/settings-service', () => ({
  getEffectiveLeagueWaiverSettings: async () => ({
    waiverType: 'faab',
    maxDropsPerWeek: null,
  }),
}))

import { assertWaiverClaimEligibility } from '@/lib/waiver-wire/transaction-eligibility'

const rosterPlayerData = { players: ['alpha-qb', 'alpha-bn'], starters: ['alpha-qb'] }

function baseResult(overrides: { blockingReasons?: Array<{ code: string; message: string }> }) {
  return {
    result: {
      isLegal: (overrides.blockingReasons ?? []).length === 0,
      irViolations: [],
      taxiViolations: [],
      devyViolations: [],
      blockingReasons: overrides.blockingReasons ?? [],
    },
    week: 6,
    season: 2026,
  }
}

describe('assertWaiverClaimEligibility — weekly lineup lock must not block bench-only free-agent adds', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findFirstLeague.mockResolvedValue({
      id: 'league-1',
      rosterSize: 20,
      sport: 'NFL',
      lockAllMoves: false,
      lifecycleState: 'in_season',
    })
    findFirstRoster.mockResolvedValue({ id: 'roster-1', playerData: rosterPlayerData, faabRemaining: 100 })
    findManyRoster.mockResolvedValue([{ id: 'roster-1', playerData: rosterPlayerData }])
    leagueWaiverSettingsFindUnique.mockResolvedValue(null)
  })

  it('allows the add when the only blocking reason is the weekly Mon-Tue lineup lock', async () => {
    evaluateLegalityForProjectedRoster.mockResolvedValue(
      baseResult({
        blockingReasons: [
          { code: 'LEAGUE_LINEUP_LOCK_ACTIVE', message: 'Lineups stay locked Mon-Tue during the active NFL/NCAAF week.' },
        ],
      }),
    )

    await expect(
      assertWaiverClaimEligibility({
        leagueId: 'league-1',
        rosterId: 'roster-1',
        addPlayerId: 'target-a',
        dropPlayerId: 'alpha-bn',
        faabBid: 1,
      }),
    ).resolves.toBeUndefined()
  })

  it('still blocks the add when a genuine roster-composition issue is present alongside the lock', async () => {
    evaluateLegalityForProjectedRoster.mockResolvedValue(
      baseResult({
        blockingReasons: [
          { code: 'LEAGUE_LINEUP_LOCK_ACTIVE', message: 'Lineups stay locked Mon-Tue during the active NFL/NCAAF week.' },
          { code: 'STARTER_SLOT_EMPTY_WHEN_REQUIRED', message: 'Not enough starters (0/9).' },
        ],
      }),
    )

    await expect(
      assertWaiverClaimEligibility({
        leagueId: 'league-1',
        rosterId: 'roster-1',
        addPlayerId: 'target-a',
        dropPlayerId: 'alpha-bn',
        faabBid: 1,
      }),
    ).rejects.toThrow('Not enough starters (0/9).')
  })
})
