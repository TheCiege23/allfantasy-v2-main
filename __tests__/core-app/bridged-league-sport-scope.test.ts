// @vitest-environment node
/**
 * 🛑 The Fleaflicker / MFL identity bridge is an NFL bridge, and says so itself (2026-11-27).
 *
 * `loadBridgedLeagues` reads `PlayerIdentityMap` rows with `sport: 'NFL'`, so a Fleaflicker NBA league
 * read through it would turn its basketball ids into NFL Sleeper ids. Until now only the 80% coverage
 * rule happened to stop that — and a provider whose NBA ids happened to equal NFL bridge ids would
 * clear it. A league whose sport is KNOWN and is not NFL is now absent from the result (no read at all),
 * which every caller already treats as "can't verify"; `bridgeColumnFor(platform, sport)` says the
 * same. An UNKNOWN sport keeps the platform-only answer, as `isKnownNonNflSport` does everywhere else.
 */
import { describe, expect, it, vi } from 'vitest'

import { bridgeColumnFor, isDeclaredReadableLeague, loadBridgedLeagues } from '@/lib/core-app/bridgedRosterIds'

const IDS = ['7000', '7001', '7002', '7003', '7004']

/** Every id bridges: 100% coverage, the most a league can have. */
function fullCoverageDb(column: 'fleaflickerId' | 'mflId') {
  return {
    roster: { findMany: vi.fn(async () => [{ leagueId: 'L1', playerData: { players: IDS } }]) },
    playerIdentityMap: { findMany: vi.fn(async () => IDS.map((id) => ({ [column]: id, sleeperId: `s${id}` }))) },
  }
}

describe('bridgeColumnFor — the sport is part of the answer', () => {
  it('null for a known non-NFL sport, the column for NFL, the platform answer when the sport is unknown', () => {
    expect(bridgeColumnFor('fleaflicker', 'NBA')).toBeNull()
    expect(bridgeColumnFor('mfl', 'mlb')).toBeNull()
    expect(bridgeColumnFor('yahoo', 'NHL')).toBeNull()
    expect(bridgeColumnFor('fleaflicker', 'NFL')).toBe('fleaflickerId')
    expect(bridgeColumnFor('mfl', 'nfl')).toBe('mflId')
    expect(bridgeColumnFor('fleaflicker')).toBe('fleaflickerId')
    expect(bridgeColumnFor('fleaflicker', null)).toBe('fleaflickerId')
  })
})

describe('loadBridgedLeagues — a non-NFL league is never read through NFL ids', () => {
  for (const [platform, column] of [['fleaflicker', 'fleaflickerId'], ['mfl', 'mflId']] as const) {
    it(`🛑 a ${platform} NBA league at 100% coverage is not bridged, and the registry is not read`, async () => {
      const db = fullCoverageDb(column)
      const out = await loadBridgedLeagues([{ id: 'L1', platform, sport: 'NBA' }], db as never)
      expect(out.has('L1')).toBe(false)
      expect(db.roster.findMany).not.toHaveBeenCalled()
      expect(db.playerIdentityMap.findMany).not.toHaveBeenCalled()
    })

    it(`CONTROL: the same ${platform} rosters in an NFL league ARE bridged`, async () => {
      const db = fullCoverageDb(column)
      const out = await loadBridgedLeagues([{ id: 'L1', platform, sport: 'NFL' }], db as never)
      expect(out.get('L1')).toMatchObject({ readable: true, total: 5, translated: 5, column })
      expect(out.get('L1')!.map.get('7000')).toBe('s7000')
    })
  }

  it('a mixed call keeps the NFL league and drops only the other sport', async () => {
    const db = fullCoverageDb('fleaflickerId')
    db.roster.findMany = vi.fn(async () => [
      { leagueId: 'NFL1', playerData: { players: IDS } },
      { leagueId: 'NBA1', playerData: { players: IDS } },
    ])
    const out = await loadBridgedLeagues(
      [
        { id: 'NFL1', platform: 'fleaflicker', sport: 'NFL' },
        { id: 'NBA1', platform: 'fleaflicker', sport: 'NBA' },
      ],
      db as never,
    )
    expect([...out.keys()]).toEqual(['NFL1'])
  })

  it('a pasted Yahoo league of another sport is not declared-readable', async () => {
    const players = Array.from({ length: 5 }, (_, i) => `sleeper:${100 + i}`)
    const db = { roster: { findMany: vi.fn(async () => [{ leagueId: 'Y1', playerData: { players } }]) }, playerIdentityMap: { findMany: vi.fn(async () => []) } }
    expect(await isDeclaredReadableLeague({ id: 'Y1', platform: 'yahoo', sport: 'NBA' }, db as never)).toBe(false)
    expect(await isDeclaredReadableLeague({ id: 'Y1', platform: 'yahoo', sport: 'NFL' }, db as never)).toBe(true)
  })
})
