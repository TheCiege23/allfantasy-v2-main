/**
 * 🛑 `LeagueTeam.isCommissioner` was only ever set for Sleeper.
 *
 * The bootstrap writes `isCommissioner: Boolean(r.is_commissioner)` for every provider, but
 * only `SleeperRosterMapper` ever put `is_commissioner` on a normalized roster. ESPN and Yahoo
 * both FETCH the commissioner — the gate already reads `commissionerTeamIds` /
 * `commissionerTeamKeys` — and the adapters dropped it, so an imported ESPN or Yahoo league
 * had no commissioner team at all.
 *
 * MFL, Fantrax and Fleaflicker are absent on purpose: none of their fetched payloads carries a
 * per-team commissioner signal (MFL's is documented absent in MflLeagueFetchService; Fleaflicker's
 * `membershipType` describes the REQUESTING user, not a team).
 */
import { describe, expect, it } from 'vitest'

import { EspnAdapter } from '@/lib/league-import/adapters/espn/EspnAdapter'
import { YahooAdapter } from '@/lib/league-import/adapters/yahoo/YahooAdapter'
import type { EspnImportPayload } from '@/lib/league-import/adapters/espn/types'
import type { YahooImportPayload } from '@/lib/league-import/adapters/yahoo/types'
import {
  isYahooCommissionerManagerForTest,
  isYahooHeadCommissionerManagerForTest,
} from '@/lib/league-import/yahoo/YahooLeagueFetchService'

function espnTeam(teamId: string) {
  return {
    teamId,
    managerId: `{MGR-${teamId}}`,
    managerName: `Manager ${teamId}`,
    teamName: `Team ${teamId}`,
    logoUrl: null,
    wins: 0,
    losses: 0,
    ties: 0,
    rank: null,
    pointsFor: 0,
    pointsAgainst: null,
    faabRemaining: null,
    waiverPriority: null,
    rosterPlayerIds: [],
    starterPlayerIds: [],
    reservePlayerIds: [],
    playerMap: {},
  }
}

function espnPayload(commissionerTeamIds: string[] | undefined): EspnImportPayload {
  return {
    sourceInput: '2026:1',
    league: {
      leagueId: '1',
      name: 'L',
      sport: 'NFL',
      season: 2026,
      size: 3,
      currentWeek: 1,
      isFinished: false,
      playoffTeamCount: null,
      regularSeasonLength: null,
    },
    settings: null,
    teams: ['1', '2', '3'].map(espnTeam),
    schedule: [],
    transactions: [],
    draftPicks: [],
    transactionsFetched: true,
    draftFetched: true,
    previousSeasons: [],
    viewerTeamId: null,
    commissionerTeamIds,
  }
}

function yahooTeam(teamKey: string) {
  return {
    teamKey,
    teamId: teamKey.split('.').pop() ?? teamKey,
    managerId: `m-${teamKey}`,
    managerGuid: `GUID-${teamKey}`,
    managerName: `Manager ${teamKey}`,
    teamName: `Team ${teamKey}`,
    logoUrl: null,
    wins: 0,
    losses: 0,
    ties: 0,
    rank: null,
    pointsFor: 0,
    pointsAgainst: null,
    faabBalance: null,
    waiverPriority: null,
    clinchedPlayoffs: false,
    rosterPlayerIds: [],
    starterPlayerIds: [],
    reservePlayerIds: [],
    playerMap: {},
    rosterFetchStatus: 'fetched' as const,
  }
}

function yahooPayload(extra: Partial<YahooImportPayload>): YahooImportPayload {
  return {
    sourceInput: '461.l.1',
    resolvedFromLeagueList: false,
    league: {
      leagueKey: '461.l.1',
      leagueId: '1',
      name: 'L',
      sport: 'NFL',
      season: 2026,
      numTeams: 3,
      draftStatus: null,
      currentWeek: 1,
      startWeek: 1,
      endWeek: 17,
      isFinished: false,
    },
    settings: null,
    teams: ['461.l.1.t.1', '461.l.1.t.2', '461.l.1.t.3'].map(yahooTeam),
    schedule: [],
    scheduleWeeksExpected: null,
    scheduleWeeksCovered: 0,
    transactions: [],
    draftPicks: [],
    previousSeasons: [],
    ...extra,
  } as YahooImportPayload
}

function flags(rosters: Array<{ source_team_id: string; is_commissioner?: boolean }>) {
  return Object.fromEntries(rosters.map((r) => [r.source_team_id, r.is_commissioner]))
}

describe('ESPN: the league manager’s team is the commissioner team', () => {
  it('flags the team in commissionerTeamIds and no other', async () => {
    const result = await EspnAdapter.normalize(espnPayload(['2']))
    expect(flags(result.rosters)).toEqual({ '1': false, '2': true, '3': false })
  })

  it('flags nobody when ESPN reported no commissioner', async () => {
    const result = await EspnAdapter.normalize(espnPayload(undefined))
    expect(flags(result.rosters)).toEqual({ '1': false, '2': false, '3': false })
  })

  it('flags nobody when EVERY team claims it — that signal identifies no one', async () => {
    const result = await EspnAdapter.normalize(espnPayload(['1', '2', '3']))
    expect(flags(result.rosters)).toEqual({ '1': false, '2': false, '3': false })
  })
})

describe('Yahoo: only the manager Yahoo marks is_commissioner', () => {
  it('flags the head commissioner’s team and no other', async () => {
    const result = await YahooAdapter.normalize(
      yahooPayload({
        headCommissionerTeamKeys: ['461.l.1.t.3'],
        // The broader list the gate reads also carries co-managers; it must not decide this.
        commissionerTeamKeys: ['461.l.1.t.1', '461.l.1.t.3'],
      }),
    )
    expect(flags(result.rosters)).toEqual({ '461.l.1.t.1': false, '461.l.1.t.2': false, '461.l.1.t.3': true })
  })

  it('flags nobody from the broad list alone', async () => {
    const result = await YahooAdapter.normalize(yahooPayload({ commissionerTeamKeys: ['461.l.1.t.1'] }))
    expect(flags(result.rosters)).toEqual({ '461.l.1.t.1': false, '461.l.1.t.2': false, '461.l.1.t.3': false })
  })

  it('a team CO-MANAGER is not a commissioner, even though the gate’s broad predicate counts them', () => {
    expect(isYahooCommissionerManagerForTest({ is_co_manager: '1' })).toBe(true)
    expect(isYahooHeadCommissionerManagerForTest({ is_comanager: '1' })).toBe(false)
    expect(isYahooHeadCommissionerManagerForTest({ is_co_manager: 1 })).toBe(false)
    expect(isYahooHeadCommissionerManagerForTest({ is_co_commissioner: '1' })).toBe(false)
    expect(isYahooHeadCommissionerManagerForTest({ is_commissioner: '1' })).toBe(true)
    expect(isYahooHeadCommissionerManagerForTest({ is_commissioner: '0' })).toBe(false)
  })
})
