import { describe, expect, it } from 'vitest'

import { parseMflFutureDraftPicks } from '@/lib/league-import/mfl/MflLeagueFetchService'
import { MflAdapter } from '@/lib/league-import/adapters/mfl/MflAdapter'
import type { MflImportPayload } from '@/lib/league-import/adapters/mfl/types'

/**
 * MFL future draft picks — the dynasty asset MFL publishes and the importer never asked for.
 *
 * Sleeper was the only provider emitting `traded_picks`, which the canonical types call
 * "the single most valuable dynasty asset outside of players themselves".
 *
 * 🛑 THE ONE WAY THIS GOES BADLY WRONG, AND WHAT MOST OF THIS FILE PINS.
 * Sleeper's `/traded_picks` lists a pick only once it has LEFT its original roster, which
 * is why `persistTradedPicks` writes `traded: true` unconditionally. MFL's export lists
 * every future pick a franchise holds — its own untouched ones included. Passing that
 * through unfiltered would mark every untraded pick in the league as traded: a league of
 * twelve managers who have never traded a pick would import with a full board of them, and
 * nothing downstream could tell those from real ones.
 */

function payload(overrides: Partial<MflImportPayload> = {}): MflImportPayload {
  return {
    sourceInput: '12345',
    league: {
      leagueId: '12345',
      name: 'Test Dynasty',
      sport: 'NFL',
      season: 2026,
      size: 2,
      currentWeek: null,
      isFinished: false,
      playoffTeamCount: null,
      regularSeasonLength: null,
      url: null,
    },
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

describe('parseMflFutureDraftPicks', () => {
  it('reads the common wrapper', () => {
    const picks = parseMflFutureDraftPicks({
      futureDraftPicks: {
        franchise: [
          {
            id: '0001',
            futureDraftPick: [
              { round: '1', year: '2027', originalPickFor: '0003' },
              { round: '2', year: '2027', originalPickFor: '0001' },
            ],
          },
        ],
      },
    })
    expect(picks).toHaveLength(2)
    expect(picks[0]).toEqual({
      currentOwnerFranchiseId: '0001',
      originalFranchiseId: '0003',
      season: 2027,
      round: 1,
    })
  })

  it('tolerates single-element collapse and $t text nodes', () => {
    const picks = parseMflFutureDraftPicks({
      futureDraftPicks: {
        franchise: {
          id: { $t: '0002' },
          futureDraftPick: { round: { $t: '3' }, year: { $t: '2028' }, originalPickFor: { $t: '0002' } },
        },
      },
    })
    expect(picks).toEqual([
      { currentOwnerFranchiseId: '0002', originalFranchiseId: '0002', season: 2028, round: 3 },
    ])
  })

  /*
   * An absent `originalPickFor` means the holder's own pick. Preserved as
   * original == current rather than dropped, so the ADAPTER's filter decides — the rule
   * lives in one place and is testable there.
   */
  it('treats a pick with no stated origin as the holder own pick', () => {
    const picks = parseMflFutureDraftPicks({
      futureDraftPicks: { franchise: [{ id: '0004', futureDraftPick: [{ round: '1', year: '2027' }] }] },
    })
    expect(picks[0]).toMatchObject({ currentOwnerFranchiseId: '0004', originalFranchiseId: '0004' })
  })

  it('drops an entry whose year or round cannot be read', () => {
    const picks = parseMflFutureDraftPicks({
      futureDraftPicks: {
        franchise: [{ id: '0001', futureDraftPick: [{ round: 'x', year: '2027' }, { round: '1', year: '' }] }],
      },
    })
    expect(picks).toEqual([])
  })

  it.each([
    ['null', null],
    ['a string', 'nope'],
    ['an empty object', {}],
    ['no franchise list', { futureDraftPicks: {} }],
  ])('returns nothing for %s rather than throwing', (_label, raw) => {
    expect(parseMflFutureDraftPicks(raw)).toEqual([])
  })
})

describe('MflAdapter traded_picks', () => {
  it('emits only picks that actually changed hands', async () => {
    const result = await MflAdapter.normalize(
      payload({
        futureDraftPicks: [
          // Acquired from another franchise — a real trade.
          { currentOwnerFranchiseId: '0001', originalFranchiseId: '0003', season: 2027, round: 1 },
          // The holder's own pick, never moved. MUST NOT appear.
          { currentOwnerFranchiseId: '0001', originalFranchiseId: '0001', season: 2027, round: 2 },
          { currentOwnerFranchiseId: '0002', originalFranchiseId: '0002', season: 2028, round: 1 },
        ],
      }),
    )

    expect(result.traded_picks).toEqual([
      {
        season: 2027,
        round: 1,
        original_roster_id: '0003',
        current_owner_roster_id: '0001',
      },
    ])
  })

  /*
   * `persistTradedPicks` writes `traded: true` for everything it receives, so an empty
   * array and a list of untraded picks must be indistinguishable at this boundary.
   */
  it('emits nothing for a league where no pick has ever moved', async () => {
    const result = await MflAdapter.normalize(
      payload({
        futureDraftPicks: [
          { currentOwnerFranchiseId: '0001', originalFranchiseId: '0001', season: 2027, round: 1 },
          { currentOwnerFranchiseId: '0002', originalFranchiseId: '0002', season: 2027, round: 1 },
        ],
      }),
    )
    expect(result.traded_picks).toEqual([])
  })

  it('emits nothing when MFL returned no future picks at all', async () => {
    const result = await MflAdapter.normalize(payload())
    expect(result.traded_picks).toEqual([])
  })

  /*
   * Franchise ids are what `source_team_id` uses, so a traded pick joins to
   * `league_teams.externalId` the same way Sleeper's roster ids do. A pick keyed on
   * anything else would persist and then match no team.
   */
  it('keys picks on the same franchise id the rosters use', async () => {
    const result = await MflAdapter.normalize(
      payload({
        teams: [
          {
            franchiseId: '0003',
            managerId: 'm3',
            managerName: 'Three',
            teamName: 'Team Three',
            logoUrl: null,
            wins: 0,
            losses: 0,
            ties: 0,
            rank: null,
            pointsFor: 0,
            pointsAgainst: null,
            rosterPlayerIds: [],
            starterPlayerIds: [],
          } as unknown as MflImportPayload['teams'][number],
        ],
        futureDraftPicks: [
          { currentOwnerFranchiseId: '0001', originalFranchiseId: '0003', season: 2027, round: 1 },
        ],
      }),
    )
    const rosterIds = result.rosters.map((r) => r.source_team_id)
    expect(rosterIds).toContain('0003')
    expect(result.traded_picks?.[0]?.original_roster_id).toBe('0003')
  })
})
