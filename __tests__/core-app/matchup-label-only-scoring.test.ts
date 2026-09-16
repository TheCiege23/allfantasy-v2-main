// @vitest-environment node
/**
 * The Matchup tab and a league whose stored settings are a label, not a rulebook
 * (scoring audit, 2026-09-16).
 *
 * `extractScoringSettings` returns that metadata object as-is, so the tab used to call the
 * scoring "available", price every starter to null, and then blame the projection feed:
 * "N starters could not be priced". It now gives the same reason My Team and the league
 * scoreboard give for the same league.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const db = vi.hoisted(() => ({ settings: null as unknown }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    roster: {
      findMany: vi.fn(async () => [
        { platformUserId: 'you', playerData: { starters: ['a', 'b'] } },
        { platformUserId: 'them', playerData: { starters: ['c', 'd'] } },
      ]),
    },
    league: { findUnique: vi.fn(async () => ({ settings: db.settings, platform: 'sleeper', sport: 'NFL' })) },
    fantasyProjection: {
      findMany: vi.fn(async ({ where }: { where: { playerId: { in: string[] } } }) =>
        where.playerId.in.map((playerId) => ({ playerId, stats: { stats: { rec: 5 } } })),
      ),
    },
  },
}))

vi.mock('@/lib/core-app/rosterIdCrosswalk', () => ({
  crosswalkToSleeperIds: vi.fn(async () => new Map()),
}))

import { loadSideProjections, NO_LIVE_POINTS, winProbabilityFor } from '@/lib/core-app/matchupProjections'
import { NO_LEAGUE_SCORING_REASON } from '@/lib/projections/leagueScoring'

const load = () =>
  loadSideProjections({ leagueId: 'lg', season: 2026, week: 3, yourPlatformUserId: 'you', opponentPlatformUserId: 'them' })

beforeEach(() => {
  db.settings = null
})

describe('Matchup scoring gate', () => {
  it('prices a league with real rules', async () => {
    db.settings = { scoring_settings: { rec: 1 } }
    const sides = await load()
    expect(sides?.leagueScoring).toEqual({ available: true })
    expect(sides?.you.projectedRemaining).toBe(10)
  })

  it('refuses a league with no settings at all', async () => {
    const sides = await load()
    expect(sides?.leagueScoring).toEqual({ available: false, reason: NO_LEAGUE_SCORING_REASON })
  })

  it('🛑 a label-only settings object gets the no-rules reason, not a blame on the feed', async () => {
    db.settings = { scoring_settings: { rules: {}, sport: 'NFL', preset: 'ppr', modifiers: {}, scoringFormat: 'PPR' } }
    const sides = await load()
    expect(sides?.leagueScoring).toEqual({ available: false, reason: NO_LEAGUE_SCORING_REASON })
    expect(winProbabilityFor(sides!, NO_LIVE_POINTS)).toEqual({ available: false, reason: NO_LEAGUE_SCORING_REASON })
  })
})
