import { describe, it, expect } from 'vitest'
import {
  matchProviderAthlete,
  birthDay,
  MIN_LINK_CONFIDENCE,
  type CanonicalCandidate,
} from '@/lib/player-identity/matchProviderAthlete'

const nfl = (over: Partial<CanonicalCandidate> & { id: string }): CanonicalCandidate => ({
  name: 'Josh Allen',
  sport: 'NFL',
  position: 'QB',
  team: 'BUF',
  ...over,
})

describe('matchProviderAthlete', () => {
  it('refuses a name-only match even when the pool holds exactly one candidate', () => {
    /* The whole reason this module exists. A unique name in the pool we happen to
       hold is not evidence — it is a statement about our pool, not about the person. */
    const result = matchProviderAthlete({ name: 'Josh Allen', sport: 'NFL' }, [
      nfl({ id: 'p1', position: null, team: null }),
    ])
    expect(result.matched).toBe(false)
    if (!result.matched) expect(result.reason).toMatch(/name on its own/)
  })

  it('links when the position corroborates the name', () => {
    const result = matchProviderAthlete(
      { name: 'Josh Allen', sport: 'NFL', position: 'QB', team: 'BUF' },
      [nfl({ id: 'p1' })],
    )
    expect(result).toMatchObject({ matched: true, id: 'p1' })
    if (result.matched) {
      expect(result.confidence).toBeGreaterThanOrEqual(MIN_LINK_CONFIDENCE)
      expect(result.matchedOn).toEqual(expect.arrayContaining(['name', 'position', 'team']))
    }
  })

  it('separates two Josh Allens by position — the real NFL collision', () => {
    /* QB Josh Allen (BUF) and LB Josh Allen (JAX) are both real, both current. */
    const pool = [nfl({ id: 'qb' }), nfl({ id: 'lb', position: 'LB', team: 'JAX' })]
    expect(matchProviderAthlete({ name: 'Josh Allen', sport: 'NFL', position: 'LB' }, pool))
      .toMatchObject({ matched: true, id: 'lb' })
    expect(matchProviderAthlete({ name: 'Josh Allen', sport: 'NFL', position: 'QB' }, pool))
      .toMatchObject({ matched: true, id: 'qb' })
  })

  it('refuses when two candidates tie and nothing separates them', () => {
    const result = matchProviderAthlete({ name: 'Josh Allen', sport: 'NFL', position: 'QB' }, [
      nfl({ id: 'a' }),
      nfl({ id: 'b' }),
    ])
    expect(result.matched).toBe(false)
    if (!result.matched) expect(result.reason).toMatch(/nothing separates them/)
  })

  it('never crosses sports, which is the failure that motivated the rule', () => {
    const result = matchProviderAthlete(
      { name: 'Josh Allen', sport: 'NFL', position: 'QB' },
      [nfl({ id: 'hooper', sport: 'NBA', position: 'G', team: null })],
    )
    expect(result.matched).toBe(false)
  })

  it('eliminates on a contradicting birthday even when name and position agree', () => {
    const result = matchProviderAthlete(
      { name: 'Josh Allen', sport: 'NFL', position: 'QB', dob: '1996-05-21' },
      [nfl({ id: 'p1', dob: '1997-06-13' })],
    )
    expect(result.matched).toBe(false)
  })

  it('scores a birthday agreement above a position agreement', () => {
    const withDob = matchProviderAthlete(
      { name: 'Josh Allen', sport: 'NFL', position: 'QB', dob: '1996-05-21' },
      [nfl({ id: 'p1', dob: '1996-05-21' })],
    )
    const withoutDob = matchProviderAthlete(
      { name: 'Josh Allen', sport: 'NFL', position: 'QB' },
      [nfl({ id: 'p1' })],
    )
    if (withDob.matched && withoutDob.matched) {
      expect(withDob.confidence).toBeGreaterThan(withoutDob.confidence)
    } else {
      throw new Error('both should have matched')
    }
  })

  it('still links a traded player, because a changed team is not a different person', () => {
    /* A 2023 draft board says LAR; our table says NO. Rejecting that would break
       the match for everyone who was ever traded. */
    const result = matchProviderAthlete(
      { name: 'Josh Allen', sport: 'NFL', position: 'QB', team: 'LAR' },
      [nfl({ id: 'p1', team: 'NO' })],
    )
    expect(result).toMatchObject({ matched: true, id: 'p1' })
    if (result.matched) expect(result.matchedOn).not.toContain('team')
  })

  it('treats a lineup slot as no position rather than as a position', () => {
    const result = matchProviderAthlete(
      { name: 'Josh Allen', sport: 'NFL', position: 'FLEX' },
      [nfl({ id: 'p1' })],
    )
    expect(result.matched).toBe(false)
  })

  it('reports honestly when the provider gave nothing to work with', () => {
    const result = matchProviderAthlete({ name: '   ' }, [nfl({ id: 'p1' })])
    expect(result.matched).toBe(false)
    if (!result.matched) expect(result.reason).toMatch(/no usable name/)
  })

  it('returns a miss, not a throw, on an empty pool', () => {
    const result = matchProviderAthlete({ name: 'Josh Allen', sport: 'NFL', position: 'QB' }, [])
    expect(result).toMatchObject({ matched: false, candidates: 0 })
  })
})

describe('birthDay', () => {
  it('reads a bare date as written rather than shifting it through a time zone', () => {
    expect(birthDay('1996-05-21')).toBe('1996-05-21')
    expect(birthDay('1996-05-21T00:00:00Z')).toBe('1996-05-21')
  })

  it('returns empty for anything it cannot read, and never throws', () => {
    expect(birthDay(null)).toBe('')
    expect(birthDay('')).toBe('')
    expect(birthDay('not a date')).toBe('')
    expect(birthDay(new Date('nope'))).toBe('')
  })
})
