/**
 * Fantasy OS Suite — ESPN Commissioner Import Certification phase.
 *
 * `EspnAdapter` had the same defect `SleeperLeagueMapper` had (Phase OS-C5):
 * no league-level `status` mapped through, so `League.status` (no DB default)
 * stayed `null`, hiding every ESPN-imported league from Dashboard the same
 * way. ESPN's API has no simple status string like Sleeper's — the honest
 * signal it exposes is `status.finalScoringPeriod` vs. current matchup
 * period, already computed as `EspnImportLeague.isFinished`.
 */
import { describe, expect, it } from 'vitest'
import { EspnAdapter } from '@/lib/league-import/adapters/espn/EspnAdapter'
import type { EspnImportPayload, EspnImportLeague } from '@/lib/league-import/adapters/espn/types'

function rawLeague(overrides: Partial<EspnImportLeague> = {}): EspnImportLeague {
  return {
    leagueId: 'league-1',
    name: 'Test League',
    sport: 'NFL',
    season: 2026,
    size: 12,
    currentWeek: 5,
    isFinished: false,
    playoffTeamCount: null,
    regularSeasonLength: null,
    ...overrides,
  }
}

function payload(overrides: Partial<EspnImportPayload> = {}): EspnImportPayload {
  return {
    sourceInput: 'league-1',
    league: rawLeague(),
    settings: null,
    teams: [],
    schedule: [],
    transactions: [],
    draftPicks: [],
    transactionsFetched: false,
    draftFetched: false,
    previousSeasons: [],
    ...overrides,
  }
}

describe('EspnAdapter — status field (ESPN certification phase)', () => {
  it('maps an in-progress season to "in_season", never dropping status', async () => {
    const result = await EspnAdapter.normalize(payload({ league: rawLeague({ isFinished: false }) }))
    expect(result.league.status).toBe('in_season')
  })

  it('maps a finished season to "complete"', async () => {
    const result = await EspnAdapter.normalize(payload({ league: rawLeague({ isFinished: true }) }))
    expect(result.league.status).toBe('complete')
  })
})
