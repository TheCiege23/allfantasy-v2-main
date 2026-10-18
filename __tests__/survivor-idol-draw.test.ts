import { describe, expect, it } from 'vitest'
import { BUNDLED_SURVIVOR_IDOL_TYPES, survivorIdolCopy, survivorIdolTag, survivorIdolTypeIdForPower } from '@/lib/survivor/survivorIdolTypes'
import {
  balancedDrawViolations,
  drawBalancedIdolTypes,
  resolveSurvivorIdolTypeIds,
  validatePickedIdolTypes,
  type SurvivorRandomInt,
} from '@/lib/survivor/survivorIdolDraw'
import catalog from '@/lib/survivor/idols/catalog.json'

/** Deterministic stand-in for the secure RNG so every draw below is reproducible. */
function seeded(seed: number): SurvivorRandomInt {
  let state = seed >>> 0
  return (max) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state % max
  }
}

const types = BUNDLED_SURVIVOR_IDOL_TYPES
const byId = new Map(types.map(type => [type.id, type]))

describe('idol catalog', () => {
  it('has the 20 handoff idol types with Immunity and Tribe immunity always in', () => {
    expect(types).toHaveLength(20)
    expect(types.filter(type => type.alwaysIn).map(type => type.id)).toEqual(['immunity', 'tribe-immunity'])
    expect(types.map(type => type.id)).toEqual((catalog as Array<{ id: string }>).map(row => row.id))
  })

  it('tags cards with the category and tier dots, or Always in', () => {
    expect(survivorIdolTag(byId.get('immunity')!)).toBe('Always in')
    expect(survivorIdolTag(byId.get('vote-steal')!)).toBe('Votes · ●●○')
    expect(survivorIdolTag(byId.get('first-claim')!)).toBe('Roster · ●○○')
    expect(survivorIdolTag(byId.get('second-chance')!)).toBe('Game · ●●●')
  })

  it('fills the league Point surge size and Tribute percentage into card copy', () => {
    expect(survivorIdolCopy('tribute', byId.get('tribute')!.short, { tributePct: 12 })).toBe("Take 12% of an opponent's points.")
    expect(survivorIdolCopy('point-surge', byId.get('point-surge')!.power, { pointSurgePct: 20 })).toContain('+20%')
  })

  it('maps stored engine powers and catalog ids back to art', () => {
    expect(survivorIdolTypeIdForPower('vote_shield')).toBe('immunity')
    expect(survivorIdolTypeIdForPower('triple_steal')).toBe('steal-three')
    expect(survivorIdolTypeIdForPower('point_surge')).toBe('point-surge')
    expect(survivorIdolTypeIdForPower('not_an_idol')).toBeNull()
  })
})

describe('balanced idol draw', () => {
  it.each([6, 7, 8])('every %i-idol draw keeps both protection idols and honours every balance rule', (count) => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 400; seed++) {
      const draw = drawBalancedIdolTypes(types, count, seeded(seed))
      expect(draw.ok).toBe(true)
      if (!draw.ok) return
      expect(draw.typeIds).toHaveLength(count)
      expect(new Set(draw.typeIds).size).toBe(count)
      expect(draw.typeIds.slice(0, 2)).toEqual(['immunity', 'tribe-immunity'])
      const picks = draw.typeIds.slice(2).map(id => byId.get(id)!)
      expect(picks.every(type => !type.alwaysIn)).toBe(true)
      expect(picks.filter(type => type.tier === 3).length).toBeLessThanOrEqual(1)
      const groups = new Map<string, number>()
      for (const type of picks) groups.set(type.category, (groups.get(type.category) ?? 0) + 1)
      expect(Math.max(...groups.values())).toBeLessThanOrEqual(2)
      expect(picks.some(type => type.category === 'Votes')).toBe(true)
      expect(picks.some(type => type.category === 'Scoring' || type.category === 'Roster')).toBe(true)
      expect(balancedDrawViolations(picks)).toEqual([])
      picks.forEach(type => seen.add(type.id))
    }
    // The draw reaches the whole pool rather than a fixed subset.
    expect(seen.size).toBe(18)
  })

  it('reports each rule a set of picks breaks', () => {
    const pick = (...ids: string[]) => ids.map(id => byId.get(id)!)
    expect(balancedDrawViolations(pick('steal-three', 'revote', 'point-surge', 'vote-steal'))).toContain('more than one tier-3 idol')
    expect(balancedDrawViolations(pick('vote-steal', 'extra-vote', 'silence', 'point-surge'))).toContain('more than two Votes idols')
    expect(balancedDrawViolations(pick('point-surge', 'captain', 'decoy', 'defector'))).toContain('no Votes idol')
    expect(balancedDrawViolations(pick('vote-steal', 'decoy', 'defector', 'second-chance'))).toContain('no Scoring or Roster idol')
  })

  it('rejects counts outside 6, 7 or 8', () => {
    expect(drawBalancedIdolTypes(types, 9, seeded(1))).toMatchObject({ ok: false, code: 'invalid_count' })
    expect(drawBalancedIdolTypes(types, 5, seeded(1))).toMatchObject({ ok: false, code: 'invalid_count' })
  })

  it('is fixed by the random source, so the server RNG alone decides the draw', () => {
    expect(drawBalancedIdolTypes(types, 7, seeded(42))).toEqual(drawBalancedIdolTypes(types, 7, seeded(42)))
  })

  it('stays balanced when the catalog grows past exhaustive enumeration', () => {
    const extra = Array.from({ length: 30 }, (_, index) => ({ ...byId.get('safety-net')!, id: `extra-${index}`, category: (['Scoring', 'Votes', 'Game'] as const)[index % 3], sortOrder: 100 + index }))
    const draw = drawBalancedIdolTypes([...types, ...extra], 8, seeded(7))
    expect(draw.ok).toBe(true)
    if (draw.ok) expect(balancedDrawViolations(draw.typeIds.slice(2).map(id => [...types, ...extra].find(type => type.id === id)!))).toEqual([])
  })
})

describe('commissioner picks', () => {
  it('accepts exactly count - 2 distinct non-protection types and adds the protection idols', () => {
    const result = validatePickedIdolTypes(types, 7, ['captain', 'silence', 'second-chance', 'first-claim', 'decoy'])
    expect(result).toEqual({ ok: true, typeIds: ['immunity', 'tribe-immunity', 'captain', 'silence', 'second-chance', 'first-claim', 'decoy'] })
  })

  it('refuses short, long, duplicate, unknown and protection picks', () => {
    expect(validatePickedIdolTypes(types, 7, ['captain', 'silence'])).toMatchObject({ ok: false, error: 'Pick exactly 5 idol types.' })
    expect(validatePickedIdolTypes(types, 6, ['captain', 'silence', 'decoy', 'revote', 'spyglass'])).toMatchObject({ ok: false })
    expect(validatePickedIdolTypes(types, 6, ['captain', 'captain', 'decoy', 'revote'])).toMatchObject({ ok: false })
    expect(validatePickedIdolTypes(types, 6, ['captain', 'nope', 'decoy', 'revote'])).toMatchObject({ ok: false })
    expect(validatePickedIdolTypes(types, 6, ['immunity', 'captain', 'decoy', 'revote'])).toMatchObject({ ok: false })
  })

  it('resolves pick mode from the picks and random mode from the draw', () => {
    const picks = ['captain', 'silence', 'decoy', 'revote']
    expect(resolveSurvivorIdolTypeIds(types, { mode: 'pick', count: 6, pickedTypeIds: picks }, seeded(1))).toMatchObject({ ok: true, typeIds: ['immunity', 'tribe-immunity', 'captain', 'silence', 'revote', 'decoy'] })
    expect(resolveSurvivorIdolTypeIds(types, { mode: 'random', count: 6, pickedTypeIds: picks }, seeded(1))).toMatchObject({ ok: true })
  })
})
