import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 🛑 ZOMBIE WEEKLY RESOLUTION NEVER FIRED, DESPITE A CRON RUNNING EVERY 5 MINUTES.
 *
 * `checkAllMatchupsComplete` checked `m.status === 'complete'` exactly, but no
 * writer in the codebase ever sets that literal string — every real path
 * writes `'final'` (`lib/redraft/scoringEngine.ts`,
 * `resolveNflRedraftLiveScoringRuntime.ts`). So this gate returned `false` for
 * every real week no matter how long a season ran, and `runWeeklyResolution`
 * (infections/serums/bashings/weapons/audit) always took the
 * `matchups_incomplete` skip branch on the non-force path — the one the
 * scheduled `/api/redraft/score-sync` cron actually uses.
 *
 * This pins the fix: a week where every matchup is `'final'` (the real-world
 * status) now reads as complete, matching the same status normalization
 * `server/services/matchupSources/redraftMatchupSource.ts` already uses.
 */

const { findFirstRedraftSeason, findManyRedraftMatchup } = vi.hoisted(() => ({
  findFirstRedraftSeason: vi.fn(),
  findManyRedraftMatchup: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftSeason: { findFirst: findFirstRedraftSeason },
    redraftMatchup: { findMany: findManyRedraftMatchup },
  },
}))

import { checkAllMatchupsComplete } from '@/lib/zombie/matchupCompletion'

beforeEach(() => {
  vi.clearAllMocks()
  findFirstRedraftSeason.mockResolvedValue({ id: 'season-1' })
})

describe('checkAllMatchupsComplete', () => {
  it('treats status "final" (what every real writer produces) as complete', async () => {
    findManyRedraftMatchup.mockResolvedValueOnce([
      { awayRosterId: 'r2', status: 'final' },
      { awayRosterId: 'r4', status: 'final' },
    ])

    await expect(checkAllMatchupsComplete('league-1', 1, 2026)).resolves.toBe(true)
  })

  it('is not fooled by a scheduled/active matchup', async () => {
    findManyRedraftMatchup.mockResolvedValueOnce([
      { awayRosterId: 'r2', status: 'final' },
      { awayRosterId: 'r4', status: 'active' },
    ])

    await expect(checkAllMatchupsComplete('league-1', 1, 2026)).resolves.toBe(false)
  })

  it('still requires two rosters (no bare bye treated as complete)', async () => {
    findManyRedraftMatchup.mockResolvedValueOnce([{ awayRosterId: null, status: 'final' }])

    await expect(checkAllMatchupsComplete('league-1', 1, 2026)).resolves.toBe(false)
  })

  it('returns false when the season cannot be found', async () => {
    findFirstRedraftSeason.mockResolvedValueOnce(null)

    await expect(checkAllMatchupsComplete('league-1', 1, 2026)).resolves.toBe(false)
    expect(findManyRedraftMatchup).not.toHaveBeenCalled()
  })
})
