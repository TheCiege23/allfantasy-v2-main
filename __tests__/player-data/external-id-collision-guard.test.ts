import { describe, expect, it } from 'vitest'

import { namesAgree } from '@/lib/player-data/getPlayerDataForSurface'

/**
 * The guard that stops a player being shown someone else's photograph.
 *
 * ⚠ WHY A NAME CHECK GUARDS AN ID LOOKUP. `batchLoadCanonicalPlayerMedia` keys one map by both
 * `SportsPlayer.externalId` and `SportsPlayer.sleeperId`, and those are different id spaces that
 * overlap numerically. Measured on production: `externalId` is 83% bare numerics, and those are
 * Rolling Insights ids rather than Sleeper ids — 42,032 of them collide with a Sleeper id and
 * 42,031 of those are a different person, one coincidental match in the whole table.
 *
 * The tie-break made it worse rather than better, because `rolling_insights` outranks `sleeper`
 * in `sportsPlayerSourceRank`, so the impostor was actively preferred. 211 records resolved to
 * a different person before this guard and none do after it, with all 66,766 correct id matches
 * kept.
 *
 * A name check rather than a namespace split, because the namespace differs by sport: the same
 * bare-numeric lookup that is wrong for NFL is right for the 44,450 NCAAF records, which carry
 * no Sleeper ids at all.
 */
describe('namesAgree', () => {
  it('rejects the real collisions measured in production', () => {
    // Each pair shared one id token and differed only in who they actually were.
    expect(namesAgree('Alex Singleton', 'Matt Milano')).toBe(false)
    expect(namesAgree('Chau Smith-Wade', 'Elijah Hicks')).toBe(false)
    expect(namesAgree('J.K. Dobbins', 'Canon Rooker')).toBe(false)
    expect(namesAgree('Emmanuel Forbes Jr.', 'Jordan Meredith')).toBe(false)
  })

  it('still accepts the same person spelled differently across feeds', () => {
    // Case and punctuation drift between sources and must not cost a real match.
    expect(namesAgree('Chau Smith-wade', 'Chau Smith-Wade')).toBe(true)
    expect(namesAgree('J.K. Dobbins', 'JK Dobbins')).toBe(true)
    expect(namesAgree("De'Von Achane", 'DeVon Achane')).toBe(true)
    // A generational suffix on one side only.
    expect(namesAgree('James Williams Sr.', 'James Williams')).toBe(true)
    expect(namesAgree('Odell Beckham Jr.', 'Odell Beckham')).toBe(true)
    // Accents, which one feed strips and another keeps.
    expect(namesAgree('D. Muñoz', 'D. Munoz')).toBe(true)
  })

  it('treats an empty or missing name as no agreement, never as a match', () => {
    // Two rows with no name must not collapse into each other on the strength of both being blank.
    expect(namesAgree('', '')).toBe(false)
    expect(namesAgree(null, null)).toBe(false)
    expect(namesAgree(undefined, 'Matt Milano')).toBe(false)
    expect(namesAgree('Matt Milano', null)).toBe(false)
    // Punctuation-only reduces to empty and must not match another empty.
    expect(namesAgree('...', '---')).toBe(false)
  })

  it('does not match two different people who share a surname', () => {
    expect(namesAgree('Mike Williams', 'James Williams')).toBe(false)
    expect(namesAgree('David Moore', 'Skyy Moore')).toBe(false)
  })
})
