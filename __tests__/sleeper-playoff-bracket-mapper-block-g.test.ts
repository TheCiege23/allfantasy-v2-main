/**
 * Block G — `SleeperPlayoffBracketMapper` unit tests.
 *
 * Fixture is the real `/v1/league/1180934977046089728/winners_bracket` response
 * (League 1's 2025 completed season) captured during the runtime validation pass:
 * 7 rows across 3 rounds, including 3 placement matchups (championship, 3rd, 5th).
 */
import { describe, expect, it } from 'vitest'

import { mapSleeperPlayoffBracket } from '@/lib/league-import/adapters/sleeper/SleeperPlayoffBracketMapper'
import type { SleeperImportPayload, SleeperPlayoffBracketRaw } from '@/lib/league-import/adapters/sleeper/types'

const AUDIT_WINNERS_BRACKET: SleeperPlayoffBracketRaw[] = [
  { m: 1, r: 1, l: 1, w: 3, t1: 1, t2: 3 },
  { m: 2, r: 1, l: 7, w: 5, t1: 7, t2: 5 },
  { m: 3, r: 2, l: 3, w: 8, t1: 8, t2: 3 },
  { m: 4, r: 2, l: 5, w: 10, t1: 10, t2: 5 },
  { p: 5, m: 5, r: 2, l: 1, w: 7, t1: 1, t2: 7 },
  { p: 1, m: 6, r: 3, l: 8, w: 10, t1: 8, t2: 10 },
  { p: 3, m: 7, r: 3, l: 5, w: 3, t1: 3, t2: 5 },
]

const AUDIT_LOSERS_BRACKET: SleeperPlayoffBracketRaw[] = [
  { m: 1, r: 1, t1: 2, t2: 12, w: 12, l: 2 },
  { m: 2, r: 1, t1: 4, t2: 6, w: 6, l: 4 },
]

function payloadWith(
  winnersBracket: SleeperImportPayload['winnersBracket'],
  losersBracket: SleeperImportPayload['losersBracket'],
  season = '2025',
): SleeperImportPayload {
  return {
    league: {
      league_id: '1180934977046089728',
      name: 'Not 4 the Weak!',
      sport: 'nfl',
      season,
      total_rosters: 12,
      roster_positions: [],
    } as SleeperImportPayload['league'],
    winnersBracket,
    losersBracket,
  }
}

describe('mapSleeperPlayoffBracket — audit fixture (winners only)', () => {
  const result = mapSleeperPlayoffBracket(payloadWith(AUDIT_WINNERS_BRACKET, undefined))

  it('returns a bracket (not undefined) when winners bracket present', () => {
    expect(result).toBeDefined()
  })

  it('coerces season string to int', () => {
    expect(result?.season).toBe(2025)
  })

  it('maps all 7 winners rows, tagged bracket_type=winners', () => {
    expect(result?.matchups).toHaveLength(7)
    expect(result?.matchups.every((m) => m.bracket_type === 'winners')).toBe(true)
  })

  it('preserves round and matchup_id', () => {
    expect(result?.matchups[0]).toMatchObject({ round: 1, matchup_id: 1 })
    expect(result?.matchups[5]).toMatchObject({ round: 3, matchup_id: 6 })
  })

  it('remaps t1/t2 → team1_roster_id/team2_roster_id as strings', () => {
    expect(result?.matchups[0].team1_roster_id).toBe('1')
    expect(result?.matchups[0].team2_roster_id).toBe('3')
  })

  it('remaps w/l → winner_roster_id/loser_roster_id as strings', () => {
    expect(result?.matchups[0].winner_roster_id).toBe('3')
    expect(result?.matchups[0].loser_roster_id).toBe('1')
  })

  it('preserves placement on placement matchups (championship=1, third=3, fifth=5)', () => {
    const championship = result?.matchups.find((m) => m.matchup_id === 6)
    const thirdPlace = result?.matchups.find((m) => m.matchup_id === 7)
    const fifthPlace = result?.matchups.find((m) => m.matchup_id === 5)
    expect(championship?.placement).toBe(1)
    expect(thirdPlace?.placement).toBe(3)
    expect(fifthPlace?.placement).toBe(5)
  })

  it('non-placement matchups have placement=null, not undefined', () => {
    const round1 = result?.matchups.find((m) => m.matchup_id === 1)
    expect(round1?.placement).toBeNull()
  })
})

describe('mapSleeperPlayoffBracket — combined winners + losers', () => {
  const result = mapSleeperPlayoffBracket(payloadWith(AUDIT_WINNERS_BRACKET, AUDIT_LOSERS_BRACKET))

  it('combines both brackets into one matchups array (7 + 2 = 9)', () => {
    expect(result?.matchups).toHaveLength(9)
  })

  it('correctly tags bracket_type per source', () => {
    const winnersCount = result?.matchups.filter((m) => m.bracket_type === 'winners').length
    const losersCount = result?.matchups.filter((m) => m.bracket_type === 'losers').length
    expect(winnersCount).toBe(7)
    expect(losersCount).toBe(2)
  })

  it('losers-bracket rows have no placement field populated (undefined → null)', () => {
    const losersRows = result?.matchups.filter((m) => m.bracket_type === 'losers')
    expect(losersRows?.every((m) => m.placement === null)).toBe(true)
  })
})

describe('mapSleeperPlayoffBracket — undecided slots', () => {
  it('normalizes 0 / missing team or winner/loser slots to null (not "0")', () => {
    const undecided: SleeperPlayoffBracketRaw[] = [
      { m: 1, r: 1, t1: 1, t2: 0, w: null, l: null },
      { m: 2, r: 1, t1: 2 },
    ]
    const result = mapSleeperPlayoffBracket(payloadWith(undecided, undefined))
    expect(result?.matchups[0]).toMatchObject({
      team1_roster_id: '1',
      team2_roster_id: null,
      winner_roster_id: null,
      loser_roster_id: null,
    })
    expect(result?.matchups[1]).toMatchObject({
      team1_roster_id: '2',
      team2_roster_id: null,
      winner_roster_id: null,
      loser_roster_id: null,
    })
  })
})

describe('mapSleeperPlayoffBracket — defensive dropping', () => {
  it('returns undefined when neither bracket was fetched (absent, not empty)', () => {
    expect(mapSleeperPlayoffBracket(payloadWith(undefined, undefined))).toBeUndefined()
  })

  it('returns a bracket with matchups=[] when winners bracket was fetched but empty', () => {
    const result = mapSleeperPlayoffBracket(payloadWith([], undefined))
    expect(result).toBeDefined()
    expect(result?.matchups).toEqual([])
  })

  it('drops rows missing round or matchup id', () => {
    const bad: SleeperPlayoffBracketRaw[] = [
      { m: 1, r: 1, t1: 1, t2: 2, w: 1, l: 2 }, // valid
      { r: 1, t1: 1, t2: 2 } as unknown as SleeperPlayoffBracketRaw, // missing m
      { m: 2, t1: 1, t2: 2 } as unknown as SleeperPlayoffBracketRaw, // missing r
      null as unknown as SleeperPlayoffBracketRaw,
    ]
    const result = mapSleeperPlayoffBracket(payloadWith(bad, undefined))
    expect(result?.matchups).toHaveLength(1)
    expect(result?.matchups[0]).toMatchObject({ round: 1, matchup_id: 1 })
  })

  it('accepts string-serialized numerics for round/matchup/team ids', () => {
    const stringly = [
      {
        r: '1' as unknown as number,
        m: '1' as unknown as number,
        t1: '4' as unknown as number,
        t2: '9' as unknown as number,
        w: '4' as unknown as number,
        l: '9' as unknown as number,
      },
    ]
    const result = mapSleeperPlayoffBracket(payloadWith(stringly, undefined))
    expect(result?.matchups[0]).toMatchObject({
      round: 1,
      matchup_id: 1,
      team1_roster_id: '4',
      team2_roster_id: '9',
      winner_roster_id: '4',
      loser_roster_id: '9',
    })
  })
})
