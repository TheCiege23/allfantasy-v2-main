import { describe, expect, it } from 'vitest'

import { comparePlayers } from '@/lib/core-app/playerCompare'
import type { PlayerDetail } from '@/lib/core-app/playerFinder'
import type { LeagueImpact } from '@/lib/core-app/playerImpact'

/*
 * Two players side by side, from the two details the page already loads.
 * The worked example: Kincaid and Ferguson across the same leagues — both
 * yours in Dragons (Kincaid benched behind a starting Ferguson he out-scores),
 * Ferguson someone else's in Gridiron Gang, Kincaid alone in Waiver Warriors.
 */

type Slot = { leagueId: string; leagueName: string; platform: string; slot: string; isYours: boolean; owner: { ownerName: string } | null }

function detail(name: string, externalId: string, slots: Slot[], points: Record<string, number>, over: Partial<PlayerDetail> = {}): PlayerDetail {
  const impact: LeagueImpact[] = slots
    .filter((s) => s.isYours)
    .map((s) => ({
      leagueId: s.leagueId,
      leagueName: s.leagueName,
      platform: s.platform,
      platformLeagueId: null,
      season: 2026,
      slot: s.slot,
      exactSlot: null,
      slotConfirmed: true,
      isStarting: s.slot === 'STARTER',
      afPoints: points[s.leagueId] != null ? { available: true, data: { points: points[s.leagueId], matchedKeys: 4, scoredKeys: 20 } } : { available: false, reason: 'unpriced in fixture' },
      replacements: { available: false, reason: 'none in fixture' },
      startOver: null,
    }))
  return {
    player: { externalId, sport: 'NFL', sleeperId: externalId, name, position: 'TE', team: 'BUF', imageUrl: null, number: null, rosteredIn: slots.length, platforms: [] },
    identityResolved: true,
    bio: { height: null, weight: null, age: null, college: null },
    injury: { available: false, reason: 'none' },
    seasonStats: { available: false, reason: 'none' },
    leagues: {
      available: true,
      data: slots.map((s) => ({
        leagueId: s.leagueId,
        leagueName: s.leagueName,
        platform: s.platform,
        format: 'PPR',
        platformLeagueId: null,
        season: 2026,
        slot: s.slot,
        isYours: s.isYours,
        owner: s.owner ? { teamName: 'T', ownerName: s.owner.ownerName, avatarUrl: null, externalId: '1' } : null,
      })),
    },
    projection: { available: false, reason: 'none' },
    snapShare: { available: false, reason: 'none' },
    positionRank: { available: false, reason: 'none' },
    impact: { available: true, data: impact },
    recommendedMoves: { available: false, reason: 'none' },
    freshness: { label: 'now', stale: false },
    rosterCoverage: { unmatched: [] },
    ...over,
  } as PlayerDetail
}

const yours = (leagueId: string, leagueName: string, slot: string): Slot => ({ leagueId, leagueName, platform: 'sleeper', slot, isYours: true, owner: null })
const theirs = (leagueId: string, leagueName: string, ownerName: string): Slot => ({ leagueId, leagueName, platform: 'espn', slot: 'NOT YOURS', isYours: false, owner: { ownerName } })

const KINCAID = detail(
  'Dalton Kincaid',
  'ri-1',
  [yours('L-warriors', 'Waiver Warriors', 'STARTER'), yours('L-dragons', 'Dynasty Dragons', 'BENCH')],
  { 'L-warriors': 11.1, 'L-dragons': 15.4 },
)
const FERGUSON = detail(
  'Jake Ferguson',
  'ri-2',
  [yours('L-dragons', 'Dynasty Dragons', 'STARTER'), theirs('L-gang', 'Gridiron Gang', 'tashaR')],
  { 'L-dragons': 13.0 },
)

describe('comparePlayers — rows', () => {
  it('walks the union of both players’ leagues, A’s order first, with a cell each', () => {
    const cmp = comparePlayers(KINCAID, FERGUSON)
    expect(cmp.rows.map((r) => r.leagueName)).toEqual(['Waiver Warriors', 'Dynasty Dragons', 'Gridiron Gang'])

    const warriors = cmp.rows[0]
    expect(warriors.a).toMatchObject({ slot: 'STARTER', isYours: true, points: 11.1, unchecked: false })
    expect(warriors.b).toMatchObject({ slot: null, isYours: false, points: null, unchecked: false })
    expect(warriors.gap).toBeNull() // only one side priced: no gap, not a gap of 11.1

    const gang = cmp.rows[2]
    expect(gang.a.slot).toBeNull()
    expect(gang.b).toMatchObject({ slot: 'NOT YOURS', isYours: false, ownerName: 'tashaR', points: null })
  })

  it('prices the gap only where both sides carry a league-scored number, rounded to a tenth', () => {
    const cmp = comparePlayers(KINCAID, FERGUSON)
    const dragons = cmp.rows[1]
    expect(dragons.gap).toBe(2.4)
    expect(cmp.tally).toEqual({ a: 1, b: 0, priced: 1 })
  })

  it('names the lineup fix when the benched one out-projects the starter in a league you play both', () => {
    const cmp = comparePlayers(KINCAID, FERGUSON)
    expect(cmp.rows[1].note).toBe('Start Kincaid over Ferguson')
    // The other way round: Ferguson benched behind a starting Kincaid he beats.
    const flipped = comparePlayers(
      detail('Dalton Kincaid', 'ri-1', [yours('L-x', 'X', 'STARTER')], { 'L-x': 9 }),
      detail('Jake Ferguson', 'ri-2', [yours('L-x', 'X', 'BENCH')], { 'L-x': 12 }),
    )
    expect(flipped.rows[0].note).toBe('Start Ferguson over Kincaid')
  })

  it('says who holds the other one where only one of them is yours', () => {
    const cmp = comparePlayers(
      detail('Dalton Kincaid', 'ri-1', [yours('L-gang', 'Gridiron Gang', 'STARTER')], {}),
      FERGUSON,
    )
    const gang = cmp.rows.find((r) => r.leagueId === 'L-gang')!
    expect(gang.note).toBe('Ferguson is @tashaR’s here')
  })

  it('marks a league whose rosters could not be read as unchecked, on that side only, and never counts it', () => {
    const a = detail('Dalton Kincaid', 'ri-1', [yours('L-dragons', 'Dynasty Dragons', 'STARTER')], { 'L-dragons': 10 }, {
      rosterCoverage: { unmatched: [{ leagueId: 'L-office', leagueName: 'Office Pool', platform: 'espn' }] },
    })
    const b = detail('Jake Ferguson', 'ri-2', [yours('L-office', 'Office Pool', 'STARTER'), yours('L-dragons', 'Dynasty Dragons', 'BENCH')], { 'L-dragons': 8 })
    const cmp = comparePlayers(a, b)
    const office = cmp.rows.find((r) => r.leagueId === 'L-office')!
    expect(office.a).toMatchObject({ slot: null, unchecked: true })
    expect(office.b).toMatchObject({ slot: 'STARTER', unchecked: false })
    expect(office.gap).toBeNull()
    expect(cmp.tally.priced).toBe(1)
  })
})

describe('comparePlayers — headline', () => {
  it('reads "beats in all N" with the biggest gap named when one side wins every priced league', () => {
    const a = detail('Dalton Kincaid', 'ri-1', [yours('L-1', 'One', 'STARTER'), yours('L-2', 'Two', 'STARTER')], { 'L-1': 12, 'L-2': 15.5 })
    const b = detail('Jake Ferguson', 'ri-2', [yours('L-1', 'One', 'BENCH'), yours('L-2', 'Two', 'BENCH')], { 'L-1': 10, 'L-2': 11 })
    expect(comparePlayers(a, b).headline).toBe('Kincaid beats Ferguson in all 2 priced leagues — biggest gap in Two (+4.5 for Kincaid).')
    expect(comparePlayers(b, a).headline).toBe('Kincaid beats Ferguson in all 2 priced leagues — biggest gap in Two (-4.5 for Kincaid).')
  })

  it('counts a split and a majority', () => {
    const a = detail('Dalton Kincaid', 'ri-1', [yours('L-1', 'One', 'STARTER'), yours('L-2', 'Two', 'STARTER'), yours('L-3', 'Three', 'STARTER')], { 'L-1': 12, 'L-2': 9, 'L-3': 14 })
    const b = detail('Jake Ferguson', 'ri-2', [yours('L-1', 'One', 'STARTER'), yours('L-2', 'Two', 'STARTER'), yours('L-3', 'Three', 'STARTER')], { 'L-1': 10, 'L-2': 11, 'L-3': 13 })
    expect(comparePlayers(a, b).headline).toMatch(/^Kincaid beats Ferguson in 2 of 3 priced leagues/)
    const even = detail('Jake Ferguson', 'ri-2', [yours('L-1', 'One', 'STARTER'), yours('L-2', 'Two', 'STARTER')], { 'L-1': 10, 'L-2': 11 })
    const evenA = detail('Dalton Kincaid', 'ri-1', [yours('L-1', 'One', 'STARTER'), yours('L-2', 'Two', 'STARTER')], { 'L-1': 12, 'L-2': 9 })
    expect(comparePlayers(evenA, even).headline).toMatch(/^Kincaid and Ferguson split the 2 priced leagues 1–1/)
  })

  it('falls back to the standard-scoring projection when no league priced either, and says so', () => {
    const a = detail('Dalton Kincaid', 'ri-1', [], {}, { projection: { available: true, data: { points: 13.8, season: '2026', week: 12 } } })
    const b = detail('Jake Ferguson', 'ri-2', [], {}, { projection: { available: true, data: { points: 11.2, season: '2026', week: 12 } } })
    const cmp = comparePlayers(a, b)
    expect(cmp.headline).toBe('Kincaid projects higher this week — 13.8 to 11.2, standard scoring. No league-scored number for either yet.')
    expect(cmp.standard).toEqual({ a: 13.8, b: 11.2, week: 12 })
    expect(cmp.rows).toEqual([])
  })

  it('says there is nothing to price rather than inventing a number', () => {
    expect(comparePlayers(detail('A B', 'x', [], {}), detail('C D', 'y', [], {})).headline).toBe('Nothing to price for these two yet.')
  })
})
