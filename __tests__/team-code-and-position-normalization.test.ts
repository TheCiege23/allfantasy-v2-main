import { describe, expect, it } from 'vitest'
import {
  assertTeamCodeFits,
  normalizePositionForSport,
  normalizeTeamAbbrev,
  normalizeTeamCode,
  TEAM_CODE_MAX_LENGTH,
} from '@/lib/team-abbrev'

// The three school names confirmed overflowing SportsPlayerRecord.team (VarChar(32)) in
// production — 52 NCAAB + 28 NCAAF teams, ~7,100 player rows, blocking whole import batches.
const CONFIRMED_OVERFLOW_SCHOOLS = [
  'North Carolina Agricultural and Technical State University',
  'Alabama Agricultural and Mechanical University',
  'University of North Carolina at Chapel Hill',
]

describe('normalizeTeamCode', () => {
  it('keeps NFL abbreviations canonical and unchanged', () => {
    for (const code of ['KC', 'SF', 'PHI', 'GB']) {
      const result = normalizeTeamCode({ sport: 'NFL', rawTeam: code })
      expect(result).toMatchObject({ code, normalization: 'canonical' })
    }
    expect(normalizeTeamCode({ sport: 'NFL', rawTeam: 'JAC' })).toMatchObject({ code: 'JAX', normalization: 'canonical' })
    expect(normalizeTeamCode({ sport: 'NFL', rawTeam: 'Kansas City Chiefs' })).toMatchObject({ code: 'KC', normalization: 'canonical' })
  })

  it('never exceeds 32 characters for the confirmed overflowing school names', () => {
    for (const school of CONFIRMED_OVERFLOW_SCHOOLS) {
      for (const sport of ['NCAAF', 'NCAAB']) {
        const result = normalizeTeamCode({ sport, rawTeam: school })
        expect(result.code).toBeTruthy()
        expect(result.code!.length).toBeLessThanOrEqual(TEAM_CODE_MAX_LENGTH)
        // The full display name is preserved, not discarded.
        expect(result.originalName).toBe(school)
      }
    }
  })

  it('prefers the provider name → code map when supplied (SportsTeam.shortName tier)', () => {
    const teamCodeMap = new Map([
      ['ALABAMA AGRICULTURAL AND MECHANICAL UNIVERSITY', 'AAMU'],
      ['UNIVERSITY OF NORTH CAROLINA AT CHAPEL HILL', 'UNC'],
    ])
    expect(
      normalizeTeamCode({ sport: 'NCAAF', rawTeam: 'Alabama Agricultural and Mechanical University', teamCodeMap })
    ).toMatchObject({ code: 'AAMU', normalization: 'mapped' })
    expect(
      normalizeTeamCode({ sport: 'NCAAB', rawTeam: 'University of North Carolina at Chapel Hill', teamCodeMap })
    ).toMatchObject({ code: 'UNC', normalization: 'mapped' })
  })

  it('passes through short provider codes verbatim', () => {
    expect(normalizeTeamCode({ sport: 'NCAAB', rawTeam: 'AAMU' })).toMatchObject({ code: 'AAMU', normalization: 'provider_code' })
    expect(normalizeTeamCode({ sport: 'NCAAF', rawTeam: 'alst' })).toMatchObject({ code: 'ALST', normalization: 'provider_code' })
  })

  it('derives a deterministic bounded code when no mapping exists', () => {
    const first = normalizeTeamCode({ sport: 'NCAAB', rawTeam: 'Some Unmapped Institution Name Nobody Registered' })
    const second = normalizeTeamCode({ sport: 'NCAAB', rawTeam: 'Some Unmapped Institution Name Nobody Registered' })
    expect(first.code).toBe(second.code)
    expect(first.code!.length).toBeLessThanOrEqual(TEAM_CODE_MAX_LENGTH)
    expect(['derived', 'truncated_fallback']).toContain(first.normalization)
  })

  it('reports missing input as missing, not as a fabricated code', () => {
    expect(normalizeTeamCode({ sport: 'NCAAF', rawTeam: null })).toMatchObject({ code: null, normalization: 'missing' })
    expect(normalizeTeamCode({ sport: 'NCAAF', rawTeam: '   ' })).toMatchObject({ code: null, normalization: 'missing' })
  })

  it('documents the old behavior this replaces: normalizeTeamAbbrev returns raw overflow', () => {
    const raw = normalizeTeamAbbrev(CONFIRMED_OVERFLOW_SCHOOLS[0])
    expect(raw!.length).toBeGreaterThan(TEAM_CODE_MAX_LENGTH)
  })
})

describe('assertTeamCodeFits', () => {
  it('passes bounded codes and nulls through', () => {
    expect(assertTeamCodeFits('AAMU')).toBe('AAMU')
    expect(assertTeamCodeFits(null)).toBeNull()
  })
  it('throws on overflow instead of letting the DB batch abort', () => {
    expect(() => assertTeamCodeFits('X'.repeat(TEAM_CODE_MAX_LENGTH + 1))).toThrow(/exceeds 32/)
  })
})

describe('normalizePositionForSport', () => {
  it('football keeps the canonical folding: C → OL', () => {
    expect(normalizePositionForSport('NFL', 'C')).toBe('OL')
    expect(normalizePositionForSport('NCAAF', 'C')).toBe('OL')
    expect(normalizePositionForSport('NFL', 'CB')).toBe('DB')
  })

  it('basketball Centers stay C (were corrupted to OL in prod)', () => {
    expect(normalizePositionForSport('NBA', 'C')).toBe('C')
    expect(normalizePositionForSport('NCAAB', 'C')).toBe('C')
    expect(normalizePositionForSport('NCAAB', 'G')).toBe('G')
    expect(normalizePositionForSport('NBA', 'PG')).toBe('PG')
  })

  it('hockey Centers and Goalies keep their codes', () => {
    expect(normalizePositionForSport('NHL', 'C')).toBe('C')
    expect(normalizePositionForSport('NHL', 'G')).toBe('G')
  })

  it('baseball Catchers keep C', () => {
    expect(normalizePositionForSport('MLB', 'C')).toBe('C')
  })
})
