/**
 * MFL Commissioner Import Certification & Fantrax Product Decision phase.
 *
 * `FantraxLeagueMapper` had the same defect Sleeper/ESPN/Yahoo/MFL had: no
 * league-level `status` mapped through. Fantrax's real signal is a
 * season-year comparison (`FantraxImportLeague.isFinished`), consistent
 * with its CSV-snapshot-upload model — there is no live in-season flag.
 */
import { describe, expect, it } from 'vitest'
import { FantraxLeagueMapper } from '@/lib/league-import/adapters/fantrax/FantraxLeagueMapper'
import type { FantraxImportPayload, FantraxImportLeague } from '@/lib/league-import/adapters/fantrax/types'

function rawLeague(overrides: Partial<FantraxImportLeague> = {}): FantraxImportLeague {
  return {
    leagueId: 'league-1',
    name: 'Test League',
    sport: 'NFL',
    season: 2026,
    size: 12,
    currentWeek: 5,
    isFinished: false,
    url: null,
    isDevy: false,
    ...overrides,
  }
}

function payload(overrides: Partial<FantraxImportPayload> = {}): FantraxImportPayload {
  return {
    sourceInput: 'league-1',
    league: rawLeague(),
    settings: null,
    teams: [],
    schedule: [],
    transactions: [],
    draftPicks: [],
    playerMap: {},
    previousSeasons: [],
    ...overrides,
  }
}

describe('FantraxLeagueMapper — status field (Fantrax product decision phase)', () => {
  it('maps a current season snapshot to "in_season", never dropping status', () => {
    const result = FantraxLeagueMapper.map(payload({ league: rawLeague({ isFinished: false }) }))
    expect(result?.status).toBe('in_season')
  })

  it('maps a past-season snapshot to "complete"', () => {
    const result = FantraxLeagueMapper.map(payload({ league: rawLeague({ isFinished: true }) }))
    expect(result?.status).toBe('complete')
  })
})
