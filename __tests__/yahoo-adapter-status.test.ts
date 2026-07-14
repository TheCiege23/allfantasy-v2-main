/**
 * Yahoo Commissioner Import Certification phase.
 *
 * `YahooAdapter` had the same defect `SleeperLeagueMapper`/`EspnAdapter` had:
 * no league-level `status` mapped through, so `League.status` (no DB
 * default) stayed `null`, hiding every Yahoo-imported league from Dashboard
 * the same way. Yahoo exposes a real `is_finished` boolean directly
 * (`YahooImportLeague.isFinished`), already fetched but never surfaced.
 */
import { describe, expect, it } from 'vitest'
import { YahooAdapter } from '@/lib/league-import/adapters/yahoo/YahooAdapter'
import type { YahooImportPayload, YahooImportLeague } from '@/lib/league-import/adapters/yahoo/types'

function rawLeague(overrides: Partial<YahooImportLeague> = {}): YahooImportLeague {
  return {
    leagueKey: '461.l.12345',
    leagueId: '12345',
    name: 'Test League',
    sport: 'NFL',
    season: 2026,
    numTeams: 12,
    draftStatus: 'postdraft',
    currentWeek: 5,
    startWeek: 1,
    endWeek: 17,
    isFinished: false,
    ...overrides,
  }
}

function payload(overrides: Partial<YahooImportPayload> = {}): YahooImportPayload {
  return {
    sourceInput: '461.l.12345',
    resolvedFromLeagueList: false,
    league: rawLeague(),
    settings: null,
    teams: [],
    schedule: [],
    scheduleWeeksExpected: null,
    scheduleWeeksCovered: 0,
    transactions: [],
    draftPicks: [],
    previousSeasons: [],
    ...overrides,
  }
}

describe('YahooAdapter — status field (Yahoo certification phase)', () => {
  it('maps an in-progress season to "in_season", never dropping status', async () => {
    const result = await YahooAdapter.normalize(payload({ league: rawLeague({ isFinished: false }) }))
    expect(result.league.status).toBe('in_season')
  })

  it('maps a finished season to "complete"', async () => {
    const result = await YahooAdapter.normalize(payload({ league: rawLeague({ isFinished: true }) }))
    expect(result.league.status).toBe('complete')
  })
})
