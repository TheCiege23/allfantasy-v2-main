import { describe, expect, it } from 'vitest'
import {
  BUNDLED_SURVIVOR_IDOL_TYPES,
  isSurvivorIdolTypePlayable,
  survivorIdolCopy,
  survivorIdolTag,
  survivorIdolTypeIdForPower,
  type SurvivorIdolTypeDef,
} from '@/lib/survivor/survivorIdolTypes'
import { SURVIVOR_IDOL_PLAY_ENGINES } from '@/lib/survivor/survivorIdolEngines'
import {
  balancedDrawViolations,
  drawBalancedIdolTypes,
  pickBounds,
  pickQuantities,
  resolveSurvivorIdolTypeIds,
  validatePickedIdolTypes,
  withPickQuantity,
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
const PLAYABLE = ['immunity', 'steal-three', 'vote-steal', 'extra-vote']

/** A catalog where every type has an engine: how the draw behaves once all engines land. */
const allPlayable: SurvivorIdolTypeDef[] = types.map(type => ({ ...type, enginePowerType: type.enginePowerType ?? 'extra_vote' }))
const allById = new Map(allPlayable.map(type => [type.id, type]))

describe('idol catalog', () => {
  it('has the 20 handoff idol types with Immunity and Tribe immunity always in', () => {
    expect(types).toHaveLength(20)
    expect(types.filter(type => type.alwaysIn).map(type => type.id)).toEqual(['immunity', 'tribe-immunity'])
    expect(types.map(type => type.id)).toEqual((catalog as Array<{ id: string }>).map(row => row.id))
  })

  it('derives "playable" from the play-engine registry: exactly the types an engine names', () => {
    const fromRegistry = Object.values(SURVIVOR_IDOL_PLAY_ENGINES).map(engine => engine.idolTypeId).filter(Boolean)
    expect(types.filter(isSurvivorIdolTypePlayable).map(type => type.id).sort()).toEqual([...new Set(fromRegistry)].sort())
    expect(types.filter(isSurvivorIdolTypePlayable).map(type => type.id).sort()).toEqual([...PLAYABLE].sort())
    expect(isSurvivorIdolTypePlayable(byId.get('tribe-immunity')!)).toBe(false)
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

describe('draw with today’s engines: playable idols only, repeats fill 6/7/8', () => {
  it.each([6, 7, 8])('every %i-idol draw over 500 seeds uses only playable types and never fails', (count) => {
    for (let seed = 1; seed <= 500; seed++) {
      const draw = drawBalancedIdolTypes(types, count, seeded(seed))
      expect(draw.ok).toBe(true)
      if (!draw.ok) return
      expect(draw.typeIds).toHaveLength(count)
      expect(draw.typeIds.every(id => PLAYABLE.includes(id))).toBe(true)
      expect(draw.typeIds).not.toContain('tribe-immunity')
      // Immunity is the only playable always-in idol, so it leads every draw exactly once.
      expect(draw.typeIds[0]).toBe('immunity')
      const picks = draw.typeIds.slice(1)
      expect(picks).not.toContain('immunity')
      // Every playable type is used before any repeats, the heavy one never repeats, and the
      // repeats are spread evenly over the lighter ones.
      expect(new Set(picks)).toEqual(new Set(['steal-three', 'vote-steal', 'extra-vote']))
      expect(picks.filter(id => id === 'steal-three')).toHaveLength(1)
      const votes = picks.filter(id => id === 'vote-steal').length
      const extra = picks.filter(id => id === 'extra-vote').length
      expect(votes + extra).toBe(count - 2)
      expect(Math.abs(votes - extra)).toBeLessThanOrEqual(1)
      // The rules that can still be met are met: one heavy idol, a Votes idol, a Roster idol.
      const violations = balancedDrawViolations(picks.map(id => byId.get(id)!))
      expect(violations.filter(rule => !rule.startsWith('more than two'))).toEqual([])
    }
  })

  it('preview and seeding use the same draw, so neither can surface a coming-soon idol', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 300; seed++) {
      const draw = drawBalancedIdolTypes(types, 7, seeded(seed))
      if (draw.ok) draw.typeIds.forEach(id => seen.add(id))
    }
    expect([...seen].sort()).toEqual([...PLAYABLE].sort())
  })

  it('rejects counts outside 6, 7 or 8', () => {
    expect(drawBalancedIdolTypes(types, 9, seeded(1))).toMatchObject({ ok: false, code: 'invalid_count' })
    expect(drawBalancedIdolTypes(types, 5, seeded(1))).toMatchObject({ ok: false, code: 'invalid_count' })
  })

  it('still fills the count when only the always-in idol is playable', () => {
    const onlyImmunity = types.map(type => (type.id === 'immunity' ? type : { ...type, enginePowerType: null }))
    expect(drawBalancedIdolTypes(onlyImmunity, 6, seeded(3))).toEqual({ ok: true, typeIds: Array(6).fill('immunity') })
  })
})

describe('draw once every engine lands: the full balanced draw comes back automatically', () => {
  it.each([6, 7, 8])('every %i-idol draw keeps both protection idols, no repeats, and honours every balance rule', (count) => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 300; seed++) {
      const draw = drawBalancedIdolTypes(allPlayable, count, seeded(seed))
      expect(draw.ok).toBe(true)
      if (!draw.ok) return
      expect(new Set(draw.typeIds).size).toBe(count)
      expect(draw.typeIds.slice(0, 2)).toEqual(['immunity', 'tribe-immunity'])
      const picks = draw.typeIds.slice(2).map(id => allById.get(id)!)
      expect(balancedDrawViolations(picks)).toEqual([])
      picks.forEach(type => seen.add(type.id))
    }
    expect(seen.size).toBe(18)
  })

  it('reports each rule a set of picks breaks', () => {
    const pick = (...ids: string[]) => ids.map(id => byId.get(id)!)
    expect(balancedDrawViolations(pick('steal-three', 'revote', 'point-surge', 'vote-steal'))).toContain('more than one tier-3 idol')
    expect(balancedDrawViolations(pick('vote-steal', 'extra-vote', 'silence', 'point-surge'))).toContain('more than two Votes idols')
    expect(balancedDrawViolations(pick('point-surge', 'captain', 'decoy', 'defector'))).toContain('no Votes idol')
    expect(balancedDrawViolations(pick('vote-steal', 'decoy', 'defector', 'second-chance'))).toContain('no Scoring or Roster idol')
  })

  it('stays balanced when the catalog grows past exhaustive enumeration', () => {
    const extra = Array.from({ length: 30 }, (_, index) => ({ ...allById.get('safety-net')!, id: `extra-${index}`, category: (['Scoring', 'Votes', 'Game'] as const)[index % 3], sortOrder: 100 + index }))
    const pool = [...allPlayable, ...extra]
    const draw = drawBalancedIdolTypes(pool, 8, seeded(7))
    expect(draw.ok).toBe(true)
    if (draw.ok) expect(balancedDrawViolations(draw.typeIds.slice(2).map(id => pool.find(type => type.id === id)!))).toEqual([])
  })
})

describe('commissioner picks', () => {
  it('bounds: 1 to 12 idols in all, with every playable always-in idol kept at least once', () => {
    expect(pickBounds(types)).toEqual({ min: 1, max: 12, alwaysIds: ['immunity'] })
    expect(pickBounds(allPlayable)).toEqual({ min: 2, max: 12, alwaysIds: ['immunity', 'tribe-immunity'] })
  })

  it('a quantity per type: copies are kept, always-in idols lead, and the rest follow catalogue order', () => {
    expect(validatePickedIdolTypes(types, 3, ['vote-steal', 'immunity', 'vote-steal'])).toEqual({ ok: true, typeIds: ['immunity', 'vote-steal', 'vote-steal'] })
    expect(validatePickedIdolTypes(types, 5, ['extra-vote', 'immunity', 'steal-three', 'immunity', 'vote-steal']))
      .toEqual({ ok: true, typeIds: ['immunity', 'immunity', 'steal-three', 'vote-steal', 'extra-vote'] })
    expect(validatePickedIdolTypes(types, 12, ['immunity', ...Array(11).fill('steal-three')])).toMatchObject({ ok: true })
  })

  it('rejects coming-soon (non-playable) idols, even when the count would allow them', () => {
    expect(validatePickedIdolTypes(types, 2, ['immunity', 'point-surge'])).toMatchObject({ ok: false, code: 'invalid_pick', error: expect.stringMatching(/coming soon/) })
    expect(validatePickedIdolTypes(types, 2, ['immunity', 'captain'])).toMatchObject({ ok: false, code: 'invalid_pick' })
    expect(validatePickedIdolTypes(types, 1, ['tribe-immunity'])).toMatchObject({ ok: false, code: 'invalid_pick' })
  })

  it('refuses an empty list, more than 12, a count that disagrees with the list, unknown ids, and a missing always-in idol', () => {
    expect(validatePickedIdolTypes(types, 0, [])).toMatchObject({ ok: false, code: 'invalid_count', error: 'Pick 1 to 12 idols.' })
    expect(validatePickedIdolTypes(types, 13, Array(13).fill('immunity'))).toMatchObject({ ok: false, code: 'invalid_count' })
    expect(validatePickedIdolTypes(types, 3, ['immunity', 'vote-steal'])).toMatchObject({ ok: false, code: 'invalid_pick', error: 'Pick 3 idols in total.' })
    expect(validatePickedIdolTypes(types, 2, ['immunity', 'nope'])).toMatchObject({ ok: false, code: 'invalid_pick' })
    expect(validatePickedIdolTypes(types, 1, ['vote-steal'])).toMatchObject({ ok: false, code: 'invalid_pick', error: expect.stringMatching(/immunity is in every league/) })
  })

  it('once every idol is playable, both protection idols must be kept and repeats are still allowed', () => {
    expect(validatePickedIdolTypes(allPlayable, 4, ['captain', 'immunity', 'captain', 'tribe-immunity']))
      .toEqual({ ok: true, typeIds: ['immunity', 'tribe-immunity', 'captain', 'captain'] })
    expect(validatePickedIdolTypes(allPlayable, 2, ['immunity', 'captain'])).toMatchObject({ ok: false, error: expect.stringMatching(/tribe-immunity is in every league/) })
  })

  it('quantity helpers count copies and rebuild a list for one type without touching the others', () => {
    const picked = ['immunity', 'vote-steal', 'vote-steal', 'steal-three']
    expect([...pickQuantities(picked)]).toEqual([['immunity', 1], ['vote-steal', 2], ['steal-three', 1]])
    expect(withPickQuantity(picked, 'vote-steal', 0)).toEqual(['immunity', 'steal-three'])
    expect(withPickQuantity(picked, 'extra-vote', 3)).toEqual(['immunity', 'vote-steal', 'vote-steal', 'steal-three', 'extra-vote', 'extra-vote', 'extra-vote'])
    expect(withPickQuantity(picked, 'immunity', 40)).toHaveLength(3 + 12)
  })

  it('resolves pick mode from the picks and random mode from the draw', () => {
    expect(resolveSurvivorIdolTypeIds(types, { mode: 'pick', count: 3, pickedTypeIds: ['immunity', 'steal-three', 'steal-three'] }, seeded(1))).toEqual({ ok: true, typeIds: ['immunity', 'steal-three', 'steal-three'] })
    expect(resolveSurvivorIdolTypeIds(types, { mode: 'random', count: 6, pickedTypeIds: ['steal-three'] }, seeded(1))).toMatchObject({ ok: true })
  })
})
