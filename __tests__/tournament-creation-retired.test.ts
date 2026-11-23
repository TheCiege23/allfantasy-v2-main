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

// Tournament Mode was retired from CREATION on 2026-07-23 and brought back by the owner on
// 2026-11-22. The policy module stays (retiring a concept again is one line), so this file pins
// both halves: tournaments can be created, and the mechanism still answers correctly.

describe('Tournament Mode can be created again', () => {
  it('🛑 the policy no longer refuses tournament, in any spelling', () => {
    for (const raw of ['tournament', 'TOURNAMENT', '  tournament  ', '\ttournament\n', 'ToUrNaMeNt']) {
      const normalized = normalizeConceptToFormat(raw)
      expect(normalized?.formatId).toBe('tournament')
      expect(checkRetiredConcept(normalized?.formatId), raw).toBeNull()
      expect(isRetiredConcept(normalized?.formatId), raw).toBe(false)
      expect(isRetiredRawConcept(raw), raw).toBe(false)
    }
  })

  it('no supported concept is retired', () => {
    for (const concept of [
      'redraft', 'dynasty', 'keeper', 'best_ball', 'guillotine',
      'survivor', 'devy', 'c2c', 'zombie', 'salary_cap', 'big_brother', 'tournament',
    ]) {
      expect(isRetiredConcept(concept), concept).toBe(false)
    }
  })
})

describe('the policy mechanism is kept for the next time', () => {
  it('ignores empty and nullish input rather than throwing', () => {
    for (const v of [null, undefined, '', '   ']) {
      expect(isRetiredConcept(v as string | null | undefined)).toBe(false)
    }
  })

  it('keeps the stable reason code and the error type routes translate', () => {
    expect(RETIRED_CONCEPT_REASON_CODES.tournament).toBe('TOURNAMENT_CREATION_DISABLED')
    const err = new RetiredConceptError('TOURNAMENT_CREATION_DISABLED', 'nope')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('RetiredConceptError')
    expect(err.code).toBe('TOURNAMENT_CREATION_DISABLED')
    expect(err.status).toBe(400)
  })
})

describe('existing tournaments keep resolving', () => {
  it('still normalises tournament', () => {
    expect(normalizeConceptToFormat('tournament')?.formatId).toBe('tournament')
    expect(normalizeConceptToFormat('TOURNAMENT')?.formatId).toBe('tournament')
  })
})

describe('where a tournament is created', () => {
  it('not on the single-league create form: a tournament is several leagues and has its own screen', () => {
    // The form sends one league to POST /api/leagues; a card there produced a request with no
    // concept. Tournaments are created at /tournament/create and /tournament-hub/new.
    const ids = LEAGUE_CREATE_OPTIONS_CATALOG_V1.concepts.map((c) => c.id)
    expect(ids).not.toContain('tournament')
    expect(ids.length).toBeGreaterThan(3)
    expect(ids).toContain('redraft')
  })
})
