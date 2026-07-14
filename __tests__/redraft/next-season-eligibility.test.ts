import { describe, expect, it } from 'vitest'
import { evaluateNextSeasonEligibility, type EligibilityCheckInput } from '@/lib/redraft/renewal/nextSeasonEligibility'

const COMMISSIONER = 'commissioner-1'
const OTHER_USER = 'other-user'

function baseInput(overrides: Partial<EligibilityCheckInput> = {}): EligibilityCheckInput {
  return {
    actorUserId: COMMISSIONER,
    actorRole: 'commissioner',
    requestedSeason: 2027,
    league: { id: 'league-1', userId: COMMISSIONER, sport: 'NFL', lifecycleState: 'offseason', teams: [] },
    season: { id: 'season-1', leagueId: 'league-1', sport: 'NFL', season: 2026, status: 'complete' },
    rosters: [{ id: 'r1', ownerId: 'owner-1', ownerName: 'Owner One' }],
    playoffBracketStatus: 'complete',
    existingRenewal: null,
    overrideEnabled: false,
    ...overrides,
  }
}

describe('evaluateNextSeasonEligibility', () => {
  it('is eligible for a complete NFL season with resolved playoffs and full manager mapping', () => {
    const result = evaluateNextSeasonEligibility(baseInput())
    expect(result.eligible).toBe(true)
    expect(result.violations).toEqual([])
  })

  it('is eligible for a complete NCAAF season', () => {
    const result = evaluateNextSeasonEligibility(baseInput({
      league: { id: 'league-1', userId: COMMISSIONER, sport: 'NCAAF', lifecycleState: 'offseason', teams: [] },
      season: { id: 'season-1', leagueId: 'league-1', sport: 'NCAAF', season: 2026, status: 'complete' },
    }))
    expect(result.eligible).toBe(true)
  })

  it('blocks an incomplete source season with SOURCE_SEASON_INCOMPLETE', () => {
    const result = evaluateNextSeasonEligibility(baseInput({
      season: { id: 'season-1', leagueId: 'league-1', sport: 'NFL', season: 2026, status: 'active' },
    }))
    expect(result.eligible).toBe(false)
    expect(result.violations.map((v) => v.code)).toContain('SOURCE_SEASON_INCOMPLETE')
  })

  it('blocks an unresolved NCAAF championship with UNRESOLVED_CHAMPION', () => {
    const result = evaluateNextSeasonEligibility(baseInput({
      league: { id: 'league-1', userId: COMMISSIONER, sport: 'NCAAF', lifecycleState: 'offseason', teams: [] },
      season: { id: 'season-1', leagueId: 'league-1', sport: 'NCAAF', season: 2026, status: 'complete' },
      playoffBracketStatus: 'in_progress',
    }))
    expect(result.eligible).toBe(false)
    expect(result.violations.map((v) => v.code)).toContain('UNRESOLVED_CHAMPION')
  })

  it('does not require playoff resolution when no bracket exists at all', () => {
    const result = evaluateNextSeasonEligibility(baseInput({ playoffBracketStatus: null }))
    expect(result.eligible).toBe(true)
  })

  it('blocks a missing champion the same way as any other unresolved bracket', () => {
    const result = evaluateNextSeasonEligibility(baseInput({ playoffBracketStatus: 'pending' }))
    expect(result.violations.map((v) => v.code)).toContain('UNRESOLVED_CHAMPION')
  })

  it('blocks when standings/rosters are entirely missing', () => {
    const result = evaluateNextSeasonEligibility(baseInput({ rosters: [] }))
    expect(result.violations.map((v) => v.code)).toContain('UNRESOLVED_STANDINGS')
  })

  it('blocks an unauthorized non-commissioner actor', () => {
    const result = evaluateNextSeasonEligibility(baseInput({ actorUserId: OTHER_USER }))
    expect(result.violations.map((v) => v.code)).toContain('UNAUTHORIZED')
  })

  it('permits a commissioner acting via a co-commissioner team row, not just League.userId', () => {
    const result = evaluateNextSeasonEligibility(baseInput({
      actorUserId: 'co-comm-1',
      league: { id: 'league-1', userId: COMMISSIONER, sport: 'NFL', lifecycleState: 'offseason', teams: [{ isCommissioner: false, isCoCommissioner: true, claimedByUserId: 'co-comm-1', platformUserId: null }] },
    }))
    expect(result.eligible).toBe(true)
  })

  it('blocks an administrator without an explicit override', () => {
    const result = evaluateNextSeasonEligibility(baseInput({ actorRole: 'administrator', overrideEnabled: false }))
    expect(result.violations.map((v) => v.code)).toContain('UNAUTHORIZED')
  })

  it('permits an administrator with an explicit override', () => {
    const result = evaluateNextSeasonEligibility(baseInput({ actorRole: 'administrator', overrideEnabled: true }))
    expect(result.eligible).toBe(true)
  })

  it('blocks a duplicate request once a destination season already exists', () => {
    const result = evaluateNextSeasonEligibility(baseInput({
      existingRenewal: { status: 'completed', nextSeasonId: 'existing-dest-season' },
    }))
    expect(result.violations.map((v) => v.code)).toContain('DESTINATION_ALREADY_EXISTS')
  })

  it('blocks an invalid requested-season sequence', () => {
    const result = evaluateNextSeasonEligibility(baseInput({ requestedSeason: 2029 }))
    expect(result.violations.map((v) => v.code)).toContain('INVALID_SEASON_SEQUENCE')
  })

  it('blocks manager mapping gaps with MANAGER_MAPPING_INCOMPLETE', () => {
    const result = evaluateNextSeasonEligibility(baseInput({
      rosters: [{ id: 'r1', ownerId: 'owner-1', ownerName: 'Owner One' }, { id: 'r2', ownerId: null, ownerName: 'Unclaimed' }],
    }))
    expect(result.violations.map((v) => v.code)).toContain('MANAGER_MAPPING_INCOMPLETE')
  })

  it('reports a missing source league or season with SOURCE_SEASON_NOT_FOUND, not a generic error', () => {
    const result = evaluateNextSeasonEligibility(baseInput({ league: null }))
    expect(result.violations).toEqual([{ code: 'SOURCE_SEASON_NOT_FOUND', message: expect.any(String) }])
  })

  it('blocks renewal of an already-archived source league with SOURCE_LEAGUE_ALREADY_ARCHIVED (minimal archive coordination)', () => {
    const result = evaluateNextSeasonEligibility(baseInput({
      league: { id: 'league-1', userId: COMMISSIONER, sport: 'NFL', lifecycleState: 'archived', teams: [] },
    }))
    expect(result.eligible).toBe(false)
    expect(result.violations.map((v) => v.code)).toContain('SOURCE_LEAGUE_ALREADY_ARCHIVED')
  })

  it('accumulates multiple simultaneous violations rather than stopping at the first', () => {
    const result = evaluateNextSeasonEligibility(baseInput({
      actorUserId: OTHER_USER,
      requestedSeason: 2099,
    }))
    expect(result.violations.map((v) => v.code)).toEqual(expect.arrayContaining(['UNAUTHORIZED', 'INVALID_SEASON_SEQUENCE']))
  })
})
