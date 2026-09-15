import { describe, expect, it } from 'vitest'
import { LEAGUE_CONCEPT_OPTIONS, resolveLeagueConcept } from '@/lib/league/leagueConceptOptions'

describe('league concept selection', () => {
  it('exposes every canonical format-engine concept exactly once', () => {
    expect(new Set(LEAGUE_CONCEPT_OPTIONS.map((option) => option.id)).size).toBe(12)
    expect(LEAGUE_CONCEPT_OPTIONS.map((option) => option.id)).toEqual(expect.arrayContaining([
      'redraft', 'dynasty', 'keeper', 'best_ball', 'guillotine', 'survivor',
      'tournament', 'devy', 'c2c', 'zombie', 'salary_cap', 'big_brother',
    ]))
  })

  it('keeps the human confirmation authoritative after an importer rewrites the column', () => {
    expect(resolveLeagueConcept({ leagueTypeConfirmation: { type: 'guillotine' } }, 'redraft')).toBe('guillotine')
    expect(resolveLeagueConcept({}, 'DYNASTY')).toBe('dynasty')
  })
})
