import { describe, expect, it } from 'vitest'
import { buildOpeningField } from '@/lib/tournament/seasonOpeningField'
import { completeConfig } from './helpers/seasonTournamentFixture'
const entrants = (size: number) => Array.from({ length: size }, (_, i) => ({ id: 'p' + String(i).padStart(3, '0'), userId: 'u' + i, displayName: 'Team ' + i, avatarUrl: null }))
describe('opening assignment manifest', () => {
  it.each(Array.from({ length: 33 }, (_, i) => 64 + i * 4))('assigns all %i entrants exactly once to the planned capacities', participants => {
    const config = completeConfig(); config.participants = participants
    config.finalWeek = config.secondCutWeek + Math.ceil(Math.log2(participants / 4))
    const roster = entrants(participants)
    const result = buildOpeningField(config, roster, upper => upper - 1)
    const assigned = result.leagues.flatMap(l => l.members)
    expect(assigned).toHaveLength(participants)
    expect(new Set(assigned.map(e => e.id)).size).toBe(participants)
    expect(roster).toEqual(entrants(participants))
    for (const league of result.leagues) {
      expect(league.members).toHaveLength(league.slots)
      expect(league.members.map(e => e.draftSlot)).toEqual(Array.from({ length: league.slots }, (_, i) => i + 1))
      expect(league.members.map(e => e.waiverPriority)).toEqual(Array.from({ length: league.slots }, (_, i) => league.slots - i))
    }
  })
  it('uses every Fisher–Yates draw bound once and preserves input-independent baseline order', () => {
    const calls: number[] = []
    const a = buildOpeningField(completeConfig(), entrants(64), upper => { calls.push(upper); return 0 })
    const b = buildOpeningField(completeConfig(), entrants(64).reverse(), () => 0)
    expect(a).toEqual(b)
    expect(calls).toEqual(Array.from({ length: 63 }, (_, i) => 64 - i))
    expect(a.leagues[0]!.members[0]!.id).toBe('p001')
  })
  it('rejects missing, excess or duplicated entries and invalid randomness', () => {
    expect(() => buildOpeningField(completeConfig(), entrants(63), () => 0)).toThrow('Exactly')
    expect(() => buildOpeningField(completeConfig(), entrants(65), () => 0)).toThrow('Exactly')
    const duplicate = entrants(64); duplicate[1] = duplicate[0]!
    expect(() => buildOpeningField(completeConfig(), duplicate, () => 0)).toThrow('Duplicate')
    for (const draw of [() => -1, (upper: number) => upper, () => 0.5]) expect(() => buildOpeningField(completeConfig(), entrants(64), draw)).toThrow('Invalid')
  })
})
