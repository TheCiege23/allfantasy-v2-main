/**
 * Yahoo Commissioner Import Certification phase — MFL inspected per Part 2's
 * explicit instruction ("Then inspect MFL. If MFL shares the identical
 * defect: fix it using the same canonical approach.").
 *
 * `MflAdapter` had the same defect Sleeper/ESPN/Yahoo had: no league-level
 * `status` mapped through. MFL's real signal is coarser than the others —
 * `isFinished` is a season-year comparison (`source.season < CURRENT_IMPORT_SEASON`),
 * not a live in-progress flag — but it is still real, not fabricated.
 */
import { describe, expect, it } from 'vitest'
import { MflAdapter } from '@/lib/league-import/adapters/mfl/MflAdapter'
import type { MflImportPayload, MflImportLeague } from '@/lib/league-import/adapters/mfl/types'

function rawLeague(overrides: Partial<MflImportLeague> = {}): MflImportLeague {
  return {
    leagueId: '12345',
    name: 'Test League',
    sport: 'NFL',
    season: 2026,
    size: 12,
    currentWeek: 5,
    isFinished: false,
    playoffTeamCount: null,
    regularSeasonLength: null,
    url: null,
    ...overrides,
  }
}

function payload(overrides: Partial<MflImportPayload> = {}): MflImportPayload {
  return {
    sourceInput: '12345',
    league: rawLeague(),
    settings: null,
    teams: [],
    schedule: [],
    transactions: [],
    draftPicks: [],
    playerMap: {},
    lineupBreakdownAvailable: false,
    previousSeasons: [],
    ...overrides,
  }
}

describe('MflAdapter — status field (Yahoo certification phase, MFL inspected)', () => {
  it('maps a current, in-progress season to "in_season", never dropping status', async () => {
    const result = await MflAdapter.normalize(payload({ league: rawLeague({ isFinished: false }) }))
    expect(result.league.status).toBe('in_season')
  })

  it('maps a past season to "complete"', async () => {
    const result = await MflAdapter.normalize(payload({ league: rawLeague({ isFinished: true }) }))
    expect(result.league.status).toBe('complete')
  })
})
