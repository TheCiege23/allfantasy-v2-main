/**
 * @vitest-environment node
 *
 * Taxi squads on imported NHL and MLB leagues (2026-10-26).
 *
 * Measured per provider before this change, from the adapters and the committed captures only:
 *
 *   provider     NHL/MLB taxi players                     taxi slot count
 *   sleeper      no NHL/MLB path in code (contracts/sleeper/GAPS.md)
 *   espn         ESPN has no taxi slot — fantasy-league.MLB.2026.json lineupSlotCounts has BN (16) and IL (17) only
 *   mfl          NFL only (MflLeagueFetchService hard-codes the sport)
 *   fleaflicker  read from FetchRoster's TAXI group, any sport  NEVER READ — any sport, NFL included
 *   yahoo        `NA` minors filed as INJURED RESERVE          never read
 *   fantrax      MLB `MINORS` filed as BENCH (NBA/NHL → taxi)  not captured (GAPS F-04)
 *
 * Only Fleaflicker has a capture showing a taxi group (rules.NFL.json, NFL). No provider has an
 * NHL/MLB capture showing taxi, so the NHL/MLB inputs below are built in the providers' documented
 * shapes and every new read is defensive: an unrecognised spelling keeps the old behaviour.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { fleaflickerTaxiSlots } from '@/lib/league-import/fleaflicker/fleaflickerScoringRules'
import type { FleaflickerRulesResponse } from '@/lib/league-import/fleaflicker/types'
import { splitLineupForTest as splitFantraxLineup } from '@/lib/league-import/fantrax/FantraxLeagueFetchService'
import { parseYahooRosterForTest } from '@/lib/league-import/yahoo/YahooLeagueFetchService'
import { YahooAdapter } from '@/lib/league-import/adapters/yahoo/YahooAdapter'
import type { YahooImportPayload } from '@/lib/league-import/adapters/yahoo/types'
import { buildTier0LeagueColumnPatch } from '@/lib/league-import/ImportedLeagueCommitService'
import { countTowardRosterLimit, leagueRosterLimit } from '@/lib/league/rosterLimit'

const RULES: FleaflickerRulesResponse = JSON.parse(
  readFileSync(path.join(process.cwd(), 'contracts/fleaflicker/fixtures/rules.NFL.json'), 'utf8'),
)

describe('Fleaflicker — the taxi slot count from FetchLeagueRules', () => {
  it('reads the committed capture: TAXI group, start 3', () => {
    const taxi = (RULES.rosterPositions ?? []).find((p) => p.group === 'TAXI')
    expect(taxi?.start).toBe(3) // the fixture really carries it
    expect(fleaflickerTaxiSlots(RULES)).toBe(3)
  })

  it('reads an NHL rules response the same way (same response shape for every sport)', () => {
    const nhl: FleaflickerRulesResponse = {
      rosterPositions: [
        { label: 'C', group: 'START', start: 2 },
        { label: 'G', group: 'START', start: 2 },
        { label: 'IR', group: 'INJURED', start: 2 },
        { label: 'TAXI', group: 'TAXI', start: 4 },
        { label: 'BN', max: 6 },
      ],
    }
    expect(fleaflickerTaxiSlots(nhl)).toBe(4)
  })

  it('no taxi group, or no rules at all, is "not said" (null) — never a guessed 0', () => {
    expect(fleaflickerTaxiSlots({ rosterPositions: [{ label: 'C', group: 'START', start: 2 }] })).toBeNull()
    expect(fleaflickerTaxiSlots(null)).toBeNull()
    expect(fleaflickerTaxiSlots({ rosterPositions: [{ label: 'TAXI', group: 'TAXI' }] })).toBeNull()
  })

  it('the adapter puts it on the league, and the commit writes League.taxiSlots', async () => {
    const { FleaflickerAdapter } = await import('@/lib/league-import/adapters/fleaflicker/FleaflickerAdapter')
    const team = { id: 1, name: 'Pucks', owners: [{ id: 10, displayName: 'Owner' }], recordOverall: { wins: 0, losses: 0, ties: 0 } }
    const out = await (FleaflickerAdapter as never as { normalize: (raw: unknown) => Promise<any> }).normalize({
      sport: 'NHL',
      season: 2026,
      standings: { league: { id: 9, name: 'NHL Dynasty', size: 1 }, divisions: [{ name: 'A', teams: [team] }] },
      rosters: { rosters: [{ team: { id: 1 }, players: [{ proPlayer: { id: 101 } }, { proPlayer: { id: 102 } }, { proPlayer: { id: 103 } }] }] },
      rules: { ...RULES, rosterPositions: [{ label: 'C', group: 'START', start: 1 }, { label: 'TAXI', group: 'TAXI', start: 2 }] },
      lineups: {
        '1': {
          groups: [
            { group: 'START', slots: [{ leaguePlayer: { proPlayer: { id: 101 } } }] },
            { slots: [{ leaguePlayer: { proPlayer: { id: 102 } } }] },
            { group: 'TAXI', slots: [{ leaguePlayer: { proPlayer: { id: 103 } } }] },
          ],
        },
      },
    })
    expect(out.league.sport).toBe('NHL')
    expect(out.league.taxi_slots).toBe(2)
    expect(out.rosters[0].taxi_ids).toEqual(['103'])
    expect(out.rosters[0].reserve_ids).toEqual([])
    expect(buildTier0LeagueColumnPatch(out).taxiSlots).toBe(2)
  })
})

describe('Fantrax — MLB minors are the taxi squad', () => {
  const rows = [
    { fantraxId: 'a', status: 'ACTIVE' },
    { fantraxId: 'prospect', status: 'MINORS' },
    { fantraxId: 'res', status: 'RESERVE' },
    { fantraxId: 'hurt', status: 'INJURED_RESERVE' },
  ]

  it('MLB: MINORS lands on taxi, not on the bench and never on IR', () => {
    const out = splitFantraxLineup(rows, 'mlb')
    expect(out?.taxi).toEqual(['prospect'])
    expect(out?.bench).toEqual(['res'])
    expect(out?.reserve).toEqual(['hurt'])
  })

  it('NHL keeps the taxi it already had', () => {
    expect(splitFantraxLineup(rows, 'nhl')?.taxi).toEqual(['prospect'])
  })

  it('🛑 football is unchanged: MINORS stays bench, no taxi list at all', () => {
    const out = splitFantraxLineup(rows, 'nfl')
    expect(out?.taxi).toBeUndefined()
    expect(out?.bench).toEqual(['prospect', 'res'])
  })
})

/* Yahoo's flat fragment shape, as in reserve-is-injured-reserve-only.test.ts. */
const yahooRoster = (rows: Array<{ id: string; slot: string }>) => ({
  fantasy_content: {
    team: [
      {},
      {
        roster: {
          players: rows.reduce<Record<string, unknown>>(
            (acc, row, index) => {
              acc[String(index)] = {
                player: [
                  { player_key: row.id },
                  { name: { full: row.id } },
                  { display_position: 'C' },
                  { editorial_team_abbr: 'TOR' },
                  { selected_position: [{ position: row.slot }] },
                ],
              }
              return acc
            },
            { count: rows.length },
          ),
        },
      },
    ],
  },
})

function yahooTeam(roster: ReturnType<typeof parseYahooRosterForTest>) {
  return {
    teamKey: '453.l.1.t.1', teamId: '1', managerId: 'm1', managerGuid: 'g1', managerName: 'M', teamName: 'T',
    logoUrl: null, wins: 0, losses: 0, ties: 0, rank: 1, pointsFor: 0, pointsAgainst: 0, faabBalance: null,
    waiverPriority: 1, clinchedPlayoffs: false,
    rosterPlayerIds: roster.playerIds, starterPlayerIds: roster.starterIds, reservePlayerIds: roster.reserveIds,
    minorsPlayerIds: roster.minorsIds, playerMap: roster.playerMap, rosterFetchStatus: 'fetched' as const,
  }
}

function yahooPayload(sport: string, roster: ReturnType<typeof parseYahooRosterForTest>): YahooImportPayload {
  return {
    sourceInput: '453.l.1',
    resolvedFromLeagueList: false,
    league: { leagueKey: '453.l.1', leagueId: '1', name: 'Y', sport, season: 2026, numTeams: 1, draftStatus: null, currentWeek: 1, startWeek: 1, endWeek: 25, isFinished: false },
    settings: {
      draftType: null, scoringType: 'head', usesPlayoff: false, playoffStartWeek: null, usesPlayoffReseeding: null,
      usesLockEliminatedTeams: null, usesFaab: false, tradeEndDate: null, tradeRatifyType: null,
      rosterPositions: [{ position: 'C', count: 2 }, { position: 'BN', count: 4 }, { position: 'IR', count: 1 }, { position: 'NA', count: 2 }],
      statCategories: [], statModifiers: [], raw: {},
    },
    teams: [yahooTeam(roster)],
    schedule: [], scheduleWeeksExpected: null, scheduleWeeksCovered: 0, transactions: [], draftPicks: [], previousSeasons: [],
    failedRosterTeamKeys: [],
  } as unknown as YahooImportPayload
}

describe('Yahoo — MLB/NHL `NA` (not active) is the taxi squad, not injured reserve', () => {
  const parsed = parseYahooRosterForTest(
    yahooRoster([
      { id: 'starter', slot: 'C' },
      { id: 'benched', slot: 'BN' },
      { id: 'hurt', slot: 'IR' },
      { id: 'prospect', slot: 'NA' },
    ]),
  )

  it('the parser names the NA player separately (and still files him non-starting)', () => {
    expect(parsed.minorsIds).toEqual(['prospect'])
    expect(parsed.starterIds).toEqual(['starter'])
  })

  for (const sport of ['NHL', 'MLB']) {
    it(`${sport}: NA → taxi_ids and taxi_slots; IR stays IR; the NA slots leave rosterSize`, async () => {
      const out = await YahooAdapter.normalize(yahooPayload(sport, parsed))
      expect(out.rosters[0].taxi_ids).toEqual(['prospect'])
      expect(out.rosters[0].reserve_ids).toEqual(['hurt'])
      expect(out.league.taxi_slots).toBe(2)
      expect(out.league.rosterSize).toBe(7) // 2 C + 4 BN + 1 IR, the 2 NA slots out
      expect(buildTier0LeagueColumnPatch(out).taxiSlots).toBe(2)
    })
  }

  it('🛑 any other sport is unchanged: NA stays reserve, no taxi', async () => {
    const out = await YahooAdapter.normalize(yahooPayload('NBA', parsed))
    expect(out.rosters[0].taxi_ids).toEqual([])
    expect(out.rosters[0].reserve_ids).toEqual(['hurt', 'prospect'])
    expect(out.league.taxi_slots).toBeUndefined()
    expect(out.league.rosterSize).toBe(9)
  })

  it('an older payload with no minors list maps exactly as before', async () => {
    const { minorsIds: _drop, ...legacy } = parsed
    const out = await YahooAdapter.normalize(yahooPayload('MLB', legacy as typeof parsed))
    expect(out.rosters[0].taxi_ids).toEqual([])
    expect(out.rosters[0].reserve_ids).toEqual(['hurt', 'prospect'])
  })
})

describe('the roster limit — a taxi player never counts against it', () => {
  const imported = { sport: 'NHL', settings: {}, rosterSize: 3 }
  const playerData = {
    players: ['a', 'b', 'c', 'tx1', 'tx2'],
    starters: ['a'],
    taxi: ['tx1'],
    lineup_sections: { starters: ['a'], bench: ['b', 'c'], ir: [], taxi: ['tx1', 'tx2'] },
  }

  it('an imported league (no saved slots): the taxi squad is left out of the count', () => {
    const limit = leagueRosterLimit(imported, 20)
    expect(limit).toEqual({ limit: 3, counts: 'all' })
    expect(countTowardRosterLimit(playerData, limit.counts)).toBe(3) // a, b, c — tx1, tx2 aside
  })

  it('IR still counts in the legacy rule — only taxi changed', () => {
    const withIr = { players: ['a', 'hurt'], reserve: ['hurt'], lineup_sections: { ir: ['hurt'] } }
    expect(countTowardRosterLimit(withIr, 'all')).toBe(2)
  })

  it('a flat-array roster with no taxi is counted exactly as before', () => {
    expect(countTowardRosterLimit({ players: ['a', 'b'] }, 'all')).toBe(2)
    expect(countTowardRosterLimit(['a', 'b'], 'all')).toBe(2)
  })
})
