import { describe, expect, it } from 'vitest'
import {
  canonicalIdsForSeason,
  currentSlotBySleeperOwner,
  formerSleeperManagerKey,
  formerSleeperSlotKey,
  parseFormerSleeperKey,
  sameCanonicalMap,
} from '@/lib/league-import/sleeper/historicalTeamIdentity'

describe('currentSlotBySleeperOwner', () => {
  it('prefers the import-recorded Sleeper id over a roster key that may be an AllFantasy id', () => {
    const map = currentSlotBySleeperOwner({
      rosters: [
        { platformUserId: 'af-123', playerData: { source_team_id: '4', source_manager_id: 'sx-4' } },
        { platformUserId: 'sx-6', playerData: { import: { sourceTeamId: '6', sourceManagerId: 'sx-6' } } },
        { platformUserId: 'sx-9', playerData: { source_team_id: 9 } },
      ],
      teams: [{ externalId: '2', platformUserId: 'sx-2' }, { externalId: '5', platformUserId: 'sx-4' }],
    })
    expect(Object.fromEntries(map)).toEqual({ 'sx-4': '4', 'sx-6': '6', 'sx-2': '2', 'af-123': '4', 'sx-9': '9' })
  })
})

describe('canonicalIdsForSeason', () => {
  const current = new Map([['u1', '1'], ['u2', '3'], ['co', '8']])

  it('maps owners to their slot today, departed owners and ownerless rosters to keys no team holds', () => {
    const map = canonicalIdsForSeason({
      season: 2022,
      currentSlotByOwner: current,
      rosters: [
        { roster_id: 1, owner_id: 'u1' },
        { roster_id: 2, owner_id: 'u2' },
        { roster_id: 3, owner_id: 'gone' },
        { roster_id: 4, owner_id: null },
        { roster_id: 5, owner_id: 'gone-too', co_owners: ['co'] },
      ],
    })
    expect(Object.fromEntries(map)).toEqual({
      '1': '1',
      '2': '3',
      '3': 'former:sleeper:gone',
      '4': 'former:sleeper:slot:2022:4',
      '5': '8',
    })
  })

  it('never returns a bare historical slot for a past season', () => {
    const map = canonicalIdsForSeason({ season: 2023, currentSlotByOwner: new Map(), rosters: [{ roster_id: 3, owner_id: 'x' }, { roster_id: 4 }] })
    for (const v of map.values()) expect(v.startsWith('former:sleeper:')).toBe(true)
  })

  it('in the current season every roster is its own team', () => {
    const map = canonicalIdsForSeason({ season: 2026, isCurrentSeason: true, currentSlotByOwner: current, rosters: [{ roster_id: 4, owner_id: null }, { roster_id: 1, owner_id: 'u2' }] })
    expect(Object.fromEntries(map)).toEqual({ '4': '4', '1': '1' })
  })
})

describe('former keys', () => {
  it('round-trip and stay within the 64-char column', () => {
    expect(parseFormerSleeperKey(formerSleeperManagerKey('1234567890123456789'))).toEqual({ kind: 'manager', ownerId: '1234567890123456789' })
    expect(parseFormerSleeperKey(formerSleeperSlotKey(2021, '12'))).toEqual({ kind: 'slot', season: 2021, rosterId: '12' })
    expect(parseFormerSleeperKey('7')).toBeNull()
    expect(parseFormerSleeperKey(null)).toBeNull()
    expect(formerSleeperManagerKey('1234567890123456789').length).toBeLessThanOrEqual(64)
  })

  it('compares a stored map entry for entry', () => {
    const next = new Map([['1', '1'], ['2', 'former:sleeper:x']])
    expect(sameCanonicalMap({ '2': 'former:sleeper:x', '1': '1' }, next)).toBe(true)
    expect(sameCanonicalMap({ '1': '1', '2': '2' }, next)).toBe(false)
    expect(sameCanonicalMap({ '1': '1' }, next)).toBe(false)
    expect(sameCanonicalMap(null, next)).toBe(false)
  })
})
