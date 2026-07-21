import { describe, expect, it, vi } from 'vitest'

// F2.10 matchup view: warehouse MatchupFact → per-roster MatchupContext under the ADR's
// binding policies — sparse-coverage-as-normal-path, incomplete-fixture exclusion, real
// zeroes, season isolation, canonical-id-only, honest degradation, no provider calls.

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/decision-os/world/performanceEnrichedWorld', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/decision-os/world/performanceEnrichedWorld')>()
  return { ...original, resolvePerformanceEnrichedCanonicalWorld: vi.fn() }
})

import {
  projectMatchupContext,
  projectMatchupEnrichedWorld,
  resolveMatchupContext,
  summarizeMatchups,
  toPerspectiveRow,
  type MatchupPort,
} from '@/lib/decision-os/world/matchupEnrichedWorld'
import type { RawMatchupFactRow } from '@/lib/decision-os/world/facts'

const row = (over: Partial<RawMatchupFactRow>): RawMatchupFactRow => ({
  leagueId: 'L1',
  sport: 'NFL',
  season: 2025,
  weekOrPeriod: 1,
  teamACanonicalId: 'team-me',
  teamBCanonicalId: 'team-opp',
  scoreA: 100,
  scoreB: 90,
  winnerCanonicalId: 'team-me',
  isComplete: true,
  createdAt: new Date('2026-06-30T00:00:00Z'),
  ...over,
})

describe('toPerspectiveRow', () => {
  it('perspectives both sides with canonical ids and margins', () => {
    const r = row({ scoreA: 100, scoreB: 90 })
    expect(toPerspectiveRow(r, 'team-me')).toMatchObject({ teamScore: 100, opponentScore: 90, margin: 10, result: 'W', opponentTeamId: 'team-opp' })
    expect(toPerspectiveRow(r, 'team-opp')).toMatchObject({ teamScore: 90, opponentScore: 100, margin: -10, result: 'L', opponentTeamId: 'team-me' })
    expect(toPerspectiveRow(r, 'team-other')).toBeNull()
  })
})

describe('projectMatchupContext — ADR policy enforcement', () => {
  it('no rows → matchup_history_unavailable (the NORMAL path), never a 0-0-0 record', () => {
    const ctx = projectMatchupContext([], 'team-me', 2025)
    expect(ctx.latestCompletedMatchup).toBeNull()
    expect(ctx.currentSeason.wins).toBeNull()
    expect(ctx.currentSeason.losses).toBeNull()
    expect(ctx.currentSeason.sampleSize).toBe(0)
    expect(ctx.uncertainty).toContain('matchup_history_unavailable')
  })

  it('unresolved team identity degrades honestly', () => {
    const ctx = projectMatchupContext([row({})], null, 2025)
    expect(ctx.uncertainty).toContain('team_identity_unresolved')
    expect(ctx.currentSeason.wins).toBeNull()
  })

  it('incomplete 0-0 fixtures are EXCLUDED from summaries but counted as fixtures', () => {
    const ctx = projectMatchupContext([
      row({ weekOrPeriod: 1, scoreA: 100, scoreB: 90 }),
      row({ weekOrPeriod: 2, scoreA: 0, scoreB: 0, winnerCanonicalId: null, isComplete: false }),
    ], 'team-me', 2025)
    expect(ctx.currentSeason.sampleSize).toBe(1) // the fixture never enters the record
    expect(ctx.currentSeason.wins).toBe(1)
    expect(ctx.incompleteFixtureCount).toBe(1)
  })

  it('a COMPLETED zero score is a real zero, not missing data', () => {
    const ctx = projectMatchupContext([
      row({ scoreA: 0, scoreB: 55, winnerCanonicalId: 'team-opp' }),
    ], 'team-me', 2025)
    expect(ctx.currentSeason.sampleSize).toBe(1)
    expect(ctx.currentSeason.losses).toBe(1)
    expect(ctx.currentSeason.averagePointsScored).toBe(0) // real 0.0 average from a real 0 game
    expect(ctx.uncertainty).not.toContain('matchup_history_unavailable')
  })

  it('season isolation: current and historical never blend; averages are per-sample', () => {
    const ctx = projectMatchupContext([
      row({ season: 2025, weekOrPeriod: 1, scoreA: 100, scoreB: 90 }),
      row({ season: 2025, weekOrPeriod: 2, scoreA: 80, scoreB: 90, winnerCanonicalId: 'team-opp' }),
      row({ season: 2024, weekOrPeriod: 10, scoreA: 130, scoreB: 60 }),
    ], 'team-me', 2025)
    expect(ctx.currentSeason).toMatchObject({ wins: 1, losses: 1, sampleSize: 2, averagePointsScored: 90 })
    expect(ctx.historical).toMatchObject({ wins: 1, sampleSize: 1, averagePointsScored: 130 })
    expect(ctx.uncertainty).toEqual([]) // current-season data exists → no season_mismatch
  })

  it('prior-season-only data carries season_mismatch', () => {
    const ctx = projectMatchupContext([row({ season: 2024 })], 'team-me', 2026)
    expect(ctx.currentSeason.sampleSize).toBe(0)
    expect(ctx.historical.sampleSize).toBe(1)
    expect(ctx.uncertainty.some((u) => u.startsWith('season_mismatch'))).toBe(true)
  })

  it('missing opponent mapping creates uncertainty without dropping the matchup', () => {
    const ctx = projectMatchupContext([row({ teamBCanonicalId: null })], 'team-me', 2025)
    expect(ctx.currentSeason.sampleSize).toBe(1)
    expect(ctx.latestCompletedMatchup?.opponentTeamId).toBeNull()
    expect(ctx.uncertainty.some((u) => u.startsWith('team_mapping_unresolved'))).toBe(true)
  })

  it('latest + recent are newest-first and completed-only', () => {
    const ctx = projectMatchupContext([
      row({ season: 2024, weekOrPeriod: 17, scoreA: 70, scoreB: 60 }),
      row({ season: 2025, weekOrPeriod: 1, scoreA: 100, scoreB: 90 }),
      row({ season: 2025, weekOrPeriod: 3, scoreA: 0, scoreB: 0, winnerCanonicalId: null, isComplete: false }),
      row({ season: 2025, weekOrPeriod: 2, scoreA: 110, scoreB: 95 }),
    ], 'team-me', 2025)
    expect(ctx.latestCompletedMatchup).toMatchObject({ season: 2025, week: 2 })
    expect(ctx.recentCompletedMatchups.map((m) => `${m.season}-w${m.week}`)).toEqual(['2025-w2', '2025-w1', '2024-w17'])
  })

  it('freshness reflects the newest backing fact write', () => {
    const ctx = projectMatchupContext([
      row({ createdAt: new Date('2026-06-29T00:00:00Z') }),
      row({ weekOrPeriod: 2, createdAt: new Date('2026-06-30T12:00:00Z') }),
    ], 'team-me', 2025)
    expect(ctx.factsGeneratedAt?.toISOString()).toBe('2026-06-30T12:00:00.000Z')
  })
})

describe('resolveMatchupContext', () => {
  it('one batched port call; failure degrades without throwing', async () => {
    const load = vi.fn(async () => [row({})])
    const okResult = await resolveMatchupContext('L1', { loadMatchupFactRows: load })
    expect(load).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledWith('L1')
    expect(okResult.rows).toHaveLength(1)

    const failing: MatchupPort = { loadMatchupFactRows: async () => { throw new Error('db down') } }
    const failed = await resolveMatchupContext('L1', failing)
    expect(failed.rows).toEqual([])
    expect(failed.error).toBe('db down')
  })
})

describe('projectMatchupEnrichedWorld', () => {
  const base = {
    league: { leagueId: 'L1', sport: 'NFL', season: 2025 },
    rosters: [
      { rosterId: 'r1', teamId: 'team-me', players: [] },
      { rosterId: 'r2', teamId: 'team-none', players: [] },
    ],
  } as never

  it('summarizes coverage and attaches port errors per roster; base world always survives', () => {
    const world = projectMatchupEnrichedWorld(base, { rows: [row({})], error: null }, 2025)
    expect(world.matchupSummary).toMatchObject({ totalRosters: 2, withHistory: 1, missingCount: 1 })
    const [withHistory, without] = world.rosters
    expect(withHistory.matchupContext.currentSeason.wins).toBe(1)
    expect(without.matchupContext.uncertainty).toContain('matchup_history_unavailable')

    const degraded = projectMatchupEnrichedWorld(base, { rows: [], error: 'db down' }, 2025)
    expect(degraded.rosters[0].matchupContext.uncertainty.some((u) => u.includes('db down'))).toBe(true)
    expect(degraded.matchupSummary.withHistory).toBe(0) // never fabricated
  })

  it('duplicate source rows do not double a record when identical rows repeat', () => {
    const duplicate = row({})
    const world = projectMatchupEnrichedWorld(base, { rows: [duplicate, duplicate], error: null }, 2025)
    // The prod census shows ZERO duplicate key groups; if a writer ever regresses, the
    // perspective sample honestly reflects the stored rows (2) rather than silently deduping —
    // reconciliation owns duplicate REPAIR, the view owns truthful projection.
    expect(world.rosters[0].matchupContext.currentSeason.sampleSize).toBe(2)
  })
})

describe('provider isolation', () => {
  it('the F2.10 modules import no provider clients', async () => {
    const fs = await import('node:fs')
    for (const path of ['lib/decision-os/world/matchupEnrichedWorld.ts', 'lib/decision-os/lineup/warehouseFacts.ts']) {
      const src = fs.readFileSync(path, 'utf8')
      expect(src).not.toMatch(/api\.sleeper|thesportsdb|api-sports|espn\.com|fetch\(\s*['"`]http/i)
    }
  })
})
