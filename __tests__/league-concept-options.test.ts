import { describe, expect, it } from 'vitest'
import {
  LEAGUE_CONCEPT_OPTIONS,
  isLeagueConceptType,
  leagueConceptLabel,
  readConfirmedPirateBase,
  resolveLeagueConcept,
} from '@/lib/league/leagueConceptOptions'

describe('league concept selection', () => {
  it('exposes every canonical format-engine concept exactly once, plus pirate, efl and survivor_guillotine', () => {
    const ids = LEAGUE_CONCEPT_OPTIONS.map((option) => option.id)
    expect(ids).toHaveLength(15)
    expect(new Set(ids).size).toBe(15)
    expect(ids).toEqual(expect.arrayContaining([
      'redraft', 'dynasty', 'keeper', 'best_ball', 'guillotine', 'survivor',
      'tournament', 'devy', 'c2c', 'zombie', 'salary_cap', 'big_brother',
      'pirate', 'efl', 'survivor_guillotine',
    ]))
  })

  /*
   * User, 2026-09-16: "not survivor and guillotine separate, it's a survivor
   * guillotine league, combines the 2 league types." One option — and the two
   * parents stay, because plain Survivor and plain Guillotine leagues exist too.
   */
  it('offers Survivor Guillotine as ONE option, alongside Survivor and Guillotine', () => {
    expect(isLeagueConceptType('survivor_guillotine')).toBe(true)
    expect(leagueConceptLabel('survivor_guillotine')).toBe('Survivor Guillotine')
    expect(leagueConceptLabel('survivor')).toBe('Survivor')
    expect(leagueConceptLabel('guillotine')).toBe('Guillotine')
    // The id matches the catalog entry, so the rules resolver can find it.
    expect(isLeagueConceptType('survivor_all_stars')).toBe(false)
  })

  it('offers Pirate and EFL by name (user decision 2026-09-16)', () => {
    expect(isLeagueConceptType('pirate')).toBe(true)
    expect(isLeagueConceptType('efl')).toBe(true)
    expect(leagueConceptLabel('pirate')).toBe('Pirate')
    expect(leagueConceptLabel('efl')).toBe('EFL')
    // The catalog's alias id is not a pickable concept — the picker speaks `pirate`.
    expect(isLeagueConceptType('pirate_vampire')).toBe(false)
  })

  it('reads a Pirate base only off a Pirate confirmation with a valid answer', () => {
    const conf = (c: Record<string, unknown>) => ({ leagueTypeConfirmation: c })
    expect(readConfirmedPirateBase(conf({ type: 'pirate', baseFormat: 'redraft' }))).toBe('redraft')
    expect(readConfirmedPirateBase(conf({ type: 'pirate', baseFormat: 'dynasty' }))).toBe('dynasty')
    expect(readConfirmedPirateBase(conf({ type: 'pirate' }))).toBeNull()
    expect(readConfirmedPirateBase(conf({ type: 'pirate', baseFormat: 'keeper' }))).toBeNull()
    // A stray field on another type is not an answer to a question nobody asked.
    expect(readConfirmedPirateBase(conf({ type: 'dynasty', baseFormat: 'redraft' }))).toBeNull()
    for (const s of [null, undefined, 42, [], {}, { leagueTypeConfirmation: [] }]) {
      expect(readConfirmedPirateBase(s)).toBeNull()
    }
  })

  it('keeps the human confirmation authoritative after an importer rewrites the column', () => {
    expect(resolveLeagueConcept({ leagueTypeConfirmation: { type: 'guillotine' } }, 'redraft')).toBe('guillotine')
    expect(resolveLeagueConcept({}, 'DYNASTY')).toBe('dynasty')
  })
})
