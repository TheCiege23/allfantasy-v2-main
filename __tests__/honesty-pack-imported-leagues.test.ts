import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildLeagueHomePulse } from '@/lib/decision-os/league-pulse'

const root = resolve(__dirname, '..')

function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}
function exists(rel: string): boolean {
  return existsSync(resolve(root, rel))
}

/**
 * Honesty Pack — Sleeper Legacy (imported league) beta.
 *
 * Every value shown to a user must either come from real data or clearly say it's unavailable —
 * nothing in between. These are source-level contract tests (matching this repo's existing
 * no-stub-leakage pattern in nfl-redraft-player-stat-card-no-stub.test.ts) plus one behavioral
 * test for the LeaguePulse fix, which is a pure function safe to call directly.
 */

describe('Honesty Pack — Task 1: no fabricated player projections', () => {
  it('the placeholder projection generator no longer exists', () => {
    expect(exists('components/weather/placeholderBaseline.ts')).toBe(false)
  })

  it('TeamTab does not reference the fabricated baseline', () => {
    const src = read('app/league/[leagueId]/tabs/TeamTab.tsx')
    expect(src).not.toContain('placeholderBaselineProjection')
    expect(src).not.toContain('components/weather/placeholderBaseline')
  })

  it('PlayersTab does not reference the fabricated baseline', () => {
    const src = read('app/league/[leagueId]/tabs/PlayersTab.tsx')
    expect(src).not.toContain('placeholderBaselineProjection')
    expect(src).not.toContain('components/weather/placeholderBaseline')
  })

  it('waiver-ai page has no dead reference to the fabricated baseline', () => {
    const src = read('app/waiver-ai/page.tsx')
    expect(src).not.toContain('placeholderBaseline')
  })

  it('matchup center distinguishes a real per-player projection from the flat position fallback', () => {
    const types = read('lib/matchup-center/types.ts')
    expect(types).toContain('hasRealProjection: boolean')

    const service = read('server/services/matchupCenterService.ts')
    expect(service).toContain('isReal: true')
    expect(service).toContain('isReal: false')
    expect(service).toContain('hasRealProjection: proj.isReal')

    const starterRow = read('components/matchup-center/MatchupStarterRow.tsx')
    expect(starterRow).toContain('side.hasRealProjection')
  })

  it('the engine-testing fixture builder was updated for the new required field', () => {
    const src = read('lib/engine-testing/fixtures/enginePayloadBuilders.ts')
    expect(src).toContain('hasRealProjection: true')
  })
})

describe('Honesty Pack — Task 2: LeaguePulse never shows a health score with zero real signal', () => {
  const now = new Date('2026-01-01T00:00:00.000Z')

  function team(overrides: Record<string, unknown> = {}) {
    return {
      id: 'team-1',
      platformUserId: 'sleeper-1',
      claimedByUserId: null,
      ...overrides,
    }
  }

  it('returns an insufficient-data pulse when no team in the league has been claimed by a real user', () => {
    const result = buildLeagueHomePulse({
      league: { id: 'league-1', teamCount: 10, lifecycleState: 'in_season' },
      teams: Array.from({ length: 10 }, (_, i) => team({ id: `team-${i}`, platformUserId: `sleeper-${i}` })),
      now,
    })
    expect(result.status).toBe('insufficient-data')
    expect(result.metrics.some((m) => m.label === 'Health')).toBe(false)
  })

  it('does not mistake an imported platformUserId for a real claim', () => {
    // Every team here carries a Sleeper-imported platformUserId (exactly what the import writes)
    // but none has a real AllFantasy claimedByUserId — this is the confirmed-common case for a
    // freshly imported league, and it must not score as healthy.
    const result = buildLeagueHomePulse({
      league: { id: 'league-2', teamCount: 2, lifecycleState: 'in_season' },
      teams: [team({ id: 'a', platformUserId: 'sleeper-a' }), team({ id: 'b', platformUserId: 'sleeper-b' })],
      now,
    })
    expect(result.status).toBe('insufficient-data')
  })

  it('still computes a normal score once at least one team is genuinely claimed', () => {
    const result = buildLeagueHomePulse({
      league: { id: 'league-3', teamCount: 2, lifecycleState: 'in_season' },
      teams: [
        team({ id: 'a', platformUserId: 'sleeper-a', claimedByUserId: 'user-a' }),
        team({ id: 'b', platformUserId: 'sleeper-b', claimedByUserId: 'user-b' }),
      ],
      now,
    })
    expect(result.status).not.toBe('insufficient-data')
    expect(result.metrics.some((m) => m.label === 'Health')).toBe(true)
  })
})

describe('Honesty Pack — Task 3: no mock IDP standings', () => {
  it('StandingsTab has no hardcoded MOCK rows and reuses the honest placeholder for IDP', () => {
    const src = read('app/league/[leagueId]/tabs/StandingsTab.tsx')
    expect(src).not.toMatch(/\bMOCK\b/)
    expect(src).not.toContain('Illustrative IDP standings')
    expect(src).not.toContain("{ team: 'Team A'")
    expect(src).toContain('LeagueTabPlaceholder')
    expect(src).toContain('not yet supported')
  })
})

describe('Honesty Pack — Task 4: no fabricated League Dashboard Checklist', () => {
  it('NflRedraftLeagueHomeDashboard has no static always-checked checklist', () => {
    const src = read('components/league-home/NflRedraftLeagueHomeDashboard.tsx')
    expect(src).not.toContain('Basic issue checklist')
    expect(src).not.toContain('Standings up to date')
    expect(src).not.toContain('Waivers reviewed')
    expect(src).not.toContain('League rules reviewed')
    expect(src).not.toContain('CheckCircle2')
  })
})

describe('Honesty Pack — Task 5/6: /legacy page has no fabricated identity or career stats', () => {
  it('does not hardcode a specific username, fake score, or fake career record', () => {
    const src = read('app/legacy/page.tsx')
    expect(src).not.toContain('TheCiege24')
    expect(src).not.toContain('Updated moments ago')
    expect(src).not.toContain('2918-3664-63')
    expect(src).not.toContain('284,844 XP')
    expect(src).not.toContain('43.1%')
    expect(src).not.toContain('Difficulty-adjusted')
    expect(src).toContain('session?.user?.name')
    expect(src).toContain("isn't available yet")
  })

  it('per-platform league counts are computed from the real synced-league list, not hardcoded', () => {
    const src = read('app/legacy/page.tsx')
    expect(src).not.toMatch(/>531</)
    expect(src).toContain('mockLeagues.filter')
  })
})
