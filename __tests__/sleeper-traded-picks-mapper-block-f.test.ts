/**
 * Block F — `SleeperTradedPicksMapper` unit tests.
 *
 * Fixture is a subset of the real `/v1/league/1313584523757260800/traded_picks`
 * response captured during the fidelity audit. Original: 33 picks across seasons
 * 2026–2028 and rounds 1–5. Compressed here to 6 representative rows covering:
 *   - Same-season vs future-season picks
 *   - previous_owner_id present vs absent
 *   - Every field exercised
 */
import { describe, expect, it } from 'vitest'

import { mapSleeperTradedPicks } from '@/lib/league-import/adapters/sleeper/SleeperTradedPicksMapper'
import type { SleeperImportPayload } from '@/lib/league-import/adapters/sleeper/types'

const AUDIT_TRADED_PICKS = [
  { round: 1, season: '2026', roster_id: 1, owner_id: 7, previous_owner_id: 4 },
  { round: 2, season: '2026', roster_id: 1, owner_id: 11, previous_owner_id: 12 },
  { round: 2, season: '2027', roster_id: 1, owner_id: 4, previous_owner_id: 12 },
  { round: 1, season: '2028', roster_id: 7, owner_id: 4, previous_owner_id: 7 },
  { round: 4, season: '2028', roster_id: 12, owner_id: 9, previous_owner_id: 12 },
  { round: 3, season: '2026', roster_id: 5, owner_id: 12 }, // no previous_owner_id
] as unknown as SleeperImportPayload['tradedPicks']

function payloadWith(tradedPicks: SleeperImportPayload['tradedPicks']): SleeperImportPayload {
  return {
    league: {
      league_id: '1313584523757260800',
      name: 'Not 4 the Weak!',
      sport: 'nfl',
      season: '2026',
      total_rosters: 12,
      roster_positions: [],
    } as SleeperImportPayload['league'],
    tradedPicks,
  }
}

describe('mapSleeperTradedPicks — audit fixture', () => {
  const result = mapSleeperTradedPicks(payloadWith(AUDIT_TRADED_PICKS))

  it('maps every valid row (6/6)', () => {
    expect(result).toHaveLength(6)
  })

  it('coerces season string to int', () => {
    expect(result[0].season).toBe(2026)
    expect(result[2].season).toBe(2027)
    expect(result[3].season).toBe(2028)
  })

  it('preserves round as-is', () => {
    expect(result[0].round).toBe(1)
    expect(result[4].round).toBe(4)
  })

  it('remaps roster_id → original_roster_id (as string)', () => {
    expect(result[0].original_roster_id).toBe('1')
    expect(result[3].original_roster_id).toBe('7')
    expect(result[4].original_roster_id).toBe('12')
  })

  it('remaps owner_id → current_owner_roster_id (as string)', () => {
    expect(result[0].current_owner_roster_id).toBe('7')
    expect(result[1].current_owner_roster_id).toBe('11')
    expect(result[4].current_owner_roster_id).toBe('9')
  })

  it('preserves previous_owner_id when present (as string)', () => {
    expect(result[0].previous_owner_roster_id).toBe('4')
    expect(result[1].previous_owner_roster_id).toBe('12')
    expect(result[3].previous_owner_roster_id).toBe('7')
  })

  it('omits previous_owner_roster_id when Sleeper did not supply it', () => {
    expect(result[5].previous_owner_roster_id).toBeUndefined()
  })
})

describe('mapSleeperTradedPicks — defensive dropping', () => {
  it('returns [] when tradedPicks is absent from the payload', () => {
    expect(mapSleeperTradedPicks(payloadWith(undefined))).toEqual([])
  })

  it('returns [] when tradedPicks is empty', () => {
    expect(mapSleeperTradedPicks(payloadWith([]))).toEqual([])
  })

  it('drops rows missing any required field', () => {
    const bad = [
      { round: 1, season: '2026', roster_id: 1, owner_id: 7 }, // valid
      { round: 1, season: '2026', roster_id: 1 } as unknown, // missing owner_id
      { season: '2026', roster_id: 1, owner_id: 7 } as unknown, // missing round
      { round: 1, roster_id: 1, owner_id: 7 } as unknown, // missing season
      { round: 1, season: '2026', owner_id: 7 } as unknown, // missing roster_id
      null as unknown,
      'not an object' as unknown,
    ]
    const result = mapSleeperTradedPicks(payloadWith(bad as SleeperImportPayload['tradedPicks']))
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      season: 2026,
      round: 1,
      original_roster_id: '1',
      current_owner_roster_id: '7',
      previous_owner_roster_id: undefined,
    })
  })

  it('accepts string-serialized numerics (Sleeper sometimes ships strings)', () => {
    const stringly = [
      {
        round: '3' as unknown as number,
        season: '2027',
        roster_id: '5' as unknown as number,
        owner_id: '9' as unknown as number,
        previous_owner_id: '2' as unknown as number,
      },
    ]
    const result = mapSleeperTradedPicks(payloadWith(stringly as unknown as SleeperImportPayload['tradedPicks']))
    expect(result).toEqual([
      {
        season: 2027,
        round: 3,
        original_roster_id: '5',
        current_owner_roster_id: '9',
        previous_owner_roster_id: '2',
      },
    ])
  })
})
