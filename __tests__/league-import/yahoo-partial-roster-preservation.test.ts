/**
 * IMP-04 — a failed provider roster fetch must never read as an empty roster.
 *
 * Yahoo fetches every team's roster with `Promise.allSettled`. A rejected request used to
 * be substituted with empty player/starter/reserve arrays, which the writer then wrote to
 * `Roster` — so one timed-out request out of twelve silently cleared a real roster while
 * the league still reported itself fully current.
 */

import { describe, expect, it } from 'vitest'

import { YahooAdapter } from '@/lib/league-import/adapters/yahoo/YahooAdapter'
import type { YahooImportPayload } from '@/lib/league-import/adapters/yahoo/types'

function team(teamKey: string, status: 'fetched' | 'failed') {
  return {
    teamKey,
    teamId: teamKey.split('.t.')[1] ?? teamKey,
    managerId: `mgr-${teamKey}`,
    managerGuid: `guid-${teamKey}`,
    managerName: `Manager ${teamKey}`,
    teamName: `Team ${teamKey}`,
    logoUrl: null,
    wins: 1,
    losses: 0,
    ties: 0,
    rank: 1,
    pointsFor: 100,
    pointsAgainst: 90,
    faabBalance: 100,
    waiverPriority: 1,
    clinchedPlayoffs: false,
    rosterPlayerIds: status === 'fetched' ? ['p1', 'p2'] : [],
    starterPlayerIds: status === 'fetched' ? ['p1'] : [],
    reservePlayerIds: [],
    playerMap: {},
    rosterFetchStatus: status,
  }
}

function payload(overrides: Partial<YahooImportPayload> = {}): YahooImportPayload {
  return {
    sourceInput: '423.l.12345',
    resolvedFromLeagueList: false,
    league: {
      leagueKey: '423.l.12345',
      leagueId: '12345',
      name: 'Test Yahoo League',
      sport: 'NFL',
      season: 2026,
      numTeams: 2,
      startWeek: 1,
      currentWeek: 1,
      endWeek: 17,
ようこそ: undefined,
    } as never,
    settings: null,
    teams: [team('423.l.12345.t.1', 'fetched'), team('423.l.12345.t.2', 'failed')],
    schedule: [],
    scheduleWeeksExpected: null,
    scheduleWeeksCovered: 0,
    transactions: [],
    draftPicks: [],
    previousSeasons: [],
    failedRosterTeamKeys: ['423.l.12345.t.2'],
    ...overrides,
  } as YahooImportPayload
}

describe('IMP-04 — Yahoo partial roster fetches', () => {
  it('marks the failed team as failed and the good team as fetched', async () => {
    const out = await YahooAdapter.normalize(payload())

    const good = out.rosters.find((r) => r.source_team_id === '423.l.12345.t.1')
    const bad = out.rosters.find((r) => r.source_team_id === '423.l.12345.t.2')

    expect(good?.fetch_status).toBe('fetched')
    expect(bad?.fetch_status).toBe('failed')
  })

  it('reports roster coverage as PARTIAL, not full, when a fetch failed', async () => {
    const out = await YahooAdapter.normalize(payload())
    expect(out.coverage?.currentRosters.state).toBe('partial')
    /* The count must be successful fetches, not team records. */
    expect(out.coverage?.currentRosters.count).toBe(1)
  })

  it('still reports full coverage when every roster fetch succeeded', async () => {
    const out = await YahooAdapter.normalize(
      payload({
        teams: [team('423.l.12345.t.1', 'fetched'), team('423.l.12345.t.2', 'fetched')] as never,
        failedRosterTeamKeys: [],
      }),
    )
    expect(out.coverage?.currentRosters.state).toBe('full')
    expect(out.coverage?.currentRosters.count).toBe(2)
  })
})
