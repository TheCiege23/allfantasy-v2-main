import { describe, expect, it } from 'vitest'
import {
  RETIRED_CONCEPT_REASON_CODES,
  RetiredConceptError,
  checkRetiredConcept,
  isRetiredConcept,
  isRetiredRawConcept,
} from '@/lib/league-creation/retiredConcepts'
import { normalizeConceptToFormat } from '@/lib/league-creation/canonical/normalizeConcept'
import { LEAGUE_CREATE_OPTIONS_CATALOG_V1 } from '@/lib/league-creation/options-catalog-seed-data'

// Tournament Mode was retired from active CREATION on 2026-07-23. Everything
// here asserts that new tournaments cannot be made while existing ones stay
// fully readable — the two halves of the Phase 1 product ruling.

describe('retired concepts — policy module', () => {
  it('rejects tournament with the stable reason code', () => {
    const r = checkRetiredConcept('tournament')
    expect(r).not.toBeNull()
    expect(r!.code).toBe('TOURNAMENT_CREATION_DISABLED')
    expect(RETIRED_CONCEPT_REASON_CODES.tournament).toBe('TOURNAMENT_CREATION_DISABLED')
  })

  it('exposes a user-safe message that does not leak internals', () => {
    const msg = checkRetiredConcept('tournament')!.message
    expect(msg).toMatch(/no longer available/i)
    // Must reassure that existing data still works — this is the honest half.
    expect(msg).toMatch(/existing/i)
    expect(msg).not.toMatch(/prisma|stack|undefined|null/i)
  })

  it('does not retire any currently supported concept', () => {
    for (const concept of [
      'redraft', 'dynasty', 'keeper', 'best_ball', 'guillotine',
      'survivor', 'devy', 'c2c', 'zombie', 'salary_cap', 'big_brother',
    ]) {
      expect(isRetiredConcept(concept)).toBe(false)
    }
  })
})

describe('retired concepts — bypass resistance', () => {
  // The guard runs on the NORMALISED format id, so every spelling that
  // normalizeConceptToFormat folds into `tournament` is covered by construction.
  const spellings = [
    'tournament',
    'TOURNAMENT',
    'Tournament',
    '  tournament  ',
    '\ttournament\n',
    'ToUrNaMeNt',
  ]

  for (const raw of spellings) {
    it(`blocks creation for input ${JSON.stringify(raw)}`, () => {
      const normalized = normalizeConceptToFormat(raw)
      expect(normalized?.formatId).toBe('tournament')
      expect(isRetiredConcept(normalized?.formatId)).toBe(true)
    })
  }

  it('raw-string helper folds case and whitespace too', () => {
    expect(isRetiredRawConcept('  TOURNAMENT ')).toBe(true)
    expect(isRetiredRawConcept('redraft')).toBe(false)
  })

  it('ignores empty and nullish input rather than throwing', () => {
    for (const v of [null, undefined, '', '   ']) {
      expect(isRetiredConcept(v as string | null | undefined)).toBe(false)
    }
  })

  it('does not accidentally retire a concept whose name merely contains "tournament"', () => {
    // best_ball contestStructure === 'tournament' is a different axis entirely,
    // and the Brackets feature has its own tournament tables. Guard is exact-match.
    expect(isRetiredConcept('best_ball')).toBe(false)
    expect(isRetiredConcept('tournament_bracket')).toBe(false)
    expect(isRetiredConcept('playoff_tournament')).toBe(false)
  })
})

describe('retired concepts — error type', () => {
  it('carries the code and a 400 status for route translation', () => {
    const err = new RetiredConceptError('TOURNAMENT_CREATION_DISABLED', 'nope')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('RetiredConceptError')
    expect(err.code).toBe('TOURNAMENT_CREATION_DISABLED')
    expect(err.status).toBe(400)
  })
})

describe('read compatibility is preserved', () => {
  it('still normalises tournament so existing leagues keep resolving', () => {
    // Critical: the concept map must NOT lose `tournament`, or historical
    // tournaments and imports would stop resolving. Retirement is creation-only.
    expect(normalizeConceptToFormat('tournament')?.formatId).toBe('tournament')
    expect(normalizeConceptToFormat('TOURNAMENT')?.formatId).toBe('tournament')
  })
})

describe('creation UI no longer offers Tournament', () => {
  it('the concept catalog has no tournament entry', () => {
    const ids = LEAGUE_CREATE_OPTIONS_CATALOG_V1.concepts.map((c) => c.id)
    expect(ids).not.toContain('tournament')
    // Sanity: the catalog is still populated, so an empty list can't fake a pass.
    expect(ids.length).toBeGreaterThan(3)
    expect(ids).toContain('redraft')
  })
})
