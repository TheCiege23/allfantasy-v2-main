import { describe, expect, it } from 'vitest'
import {
  aliasesForTeam,
  buildCollegeTeamIndex,
  normalizeTeamToken,
  resolveCollegeTeam,
  resolveCollegeTeamLogo,
  type CollegeTeamRecord,
} from '@/lib/sport-teams/collegeTeamIdentity'

/**
 * Measured on production: the 10-day NCAAF slate names 1,527 distinct team
 * strings for a sport with ~660 teams, and only 277 resolve to a logo. Three
 * conventions coexist — abbreviation, school+mascot, and plain school — and
 * `SportsTeam` itself is split between "Vanderbilt" (TheSportsDB, has a logo)
 * and "Vanderbilt University" (Rolling Insights, does not), with only three
 * exact name matches between the two sources.
 */
const team = (o: Partial<CollegeTeamRecord> & { id: number; school: string }): CollegeTeamRecord => ({
  mascot: null,
  abbreviation: null,
  alternateNames: null,
  classification: null,
  logo: `https://cdn.collegefootballdata.com/logos/500/${o.id}.png`,
  ...o,
})

// Real CFBD records, verbatim from the API.
const AIR_FORCE = team({ id: 2005, school: 'Air Force', mascot: 'Falcons', abbreviation: 'AF', alternateNames: ['AF', 'Air Force'], classification: 'fbs' })
const VANDERBILT = team({ id: 238, school: 'Vanderbilt', mascot: 'Commodores', abbreviation: 'VAN', alternateNames: ['VAN', 'Vanderbilt'], classification: 'fbs' })
const ABILENE = team({ id: 2000, school: 'Abilene Christian', mascot: 'Wildcats', abbreviation: 'ACU', alternateNames: ['ACU', 'Abilene Chrstn'], classification: 'fcs' })
const ADAMS = team({ id: 2001, school: 'Adams State', mascot: 'Grizzlies', abbreviation: 'ADSU', alternateNames: ['ADSU', 'Adams St'], classification: 'ii' })

describe('normalizeTeamToken', () => {
  it('collapses the institution wrappers one feed writes and another omits', () => {
    // The exact split in SportsTeam: RI writes the long form, TSDB the short.
    expect(normalizeTeamToken('Vanderbilt University')).toBe(normalizeTeamToken('Vanderbilt'))
    expect(normalizeTeamToken('University of San Diego')).toBe('san diego')
    expect(normalizeTeamToken('The Ohio State University')).toBe('ohio state')
  })

  it('is insensitive to punctuation and case', () => {
    expect(normalizeTeamToken("Texas A&M")).toBe(normalizeTeamToken('texas a and m'))
    expect(normalizeTeamToken('St. Johns')).toBe(normalizeTeamToken('st johns'))
  })

  it('does NOT rewrite St into State', () => {
    // That rewrite reads well on "Adams St" and fuses "St. John's" with a
    // hypothetical "State Johns". CFBD supplies "Adams St" as an alternateName,
    // so the alias arrives as data instead of as a guess.
    expect(normalizeTeamToken('St Johns')).not.toBe(normalizeTeamToken('State Johns'))
  })
})

describe('aliasesForTeam', () => {
  it('covers every convention the slate actually uses', () => {
    const a = aliasesForTeam(ABILENE)
    expect(a).toContain('abilene christian')          // plain school
    expect(a).toContain('abilene christian wildcats') // school + mascot
    expect(a).toContain('acu')                        // abbreviation
    expect(a).toContain('abilene chrstn')             // alternateName
  })

  it('never indexes a bare mascot', () => {
    // "Wildcats" is a dozen schools. Indexing it would resolve to whichever was
    // inserted last, which is a coin flip wearing a logo.
    expect(aliasesForTeam(ABILENE)).not.toContain('wildcats')
    expect(aliasesForTeam(VANDERBILT)).not.toContain('commodores')
  })
})

describe('buildCollegeTeamIndex', () => {
  const index = buildCollegeTeamIndex([AIR_FORCE, VANDERBILT, ABILENE, ADAMS])

  it('resolves all three conventions to the same team', () => {
    expect(resolveCollegeTeam('Air Force', index)?.id).toBe(2005)
    expect(resolveCollegeTeam('Air Force Falcons', index)?.id).toBe(2005)
    expect(resolveCollegeTeam('AF', index)?.id).toBe(2005)
  })

  it('resolves the RI long form to the TSDB short form', () => {
    // The Vanderbilt case that exposed the whole problem.
    expect(resolveCollegeTeam('Vanderbilt University', index)?.id).toBe(238)
    expect(resolveCollegeTeam('Vanderbilt', index)?.id).toBe(238)
    expect(resolveCollegeTeam('VAN', index)?.id).toBe(238)
  })

  it('returns a logo for a slate abbreviation', () => {
    expect(resolveCollegeTeamLogo('ACU', index)).toBe(
      'https://cdn.collegefootballdata.com/logos/500/2000.png',
    )
  })

  it('returns null for an unknown string rather than a near match', () => {
    // 'AFA' is ESPN's abbreviation for Air Force; CFBD says 'AF'. A resolver
    // that reached for the closest string would be right often and wrong
    // silently. Null is the correct answer until the alias arrives as data.
    expect(resolveCollegeTeam('AFA', index)).toBeNull()
    expect(resolveCollegeTeamLogo('Not A Real School', index)).toBeNull()
  })

  it('DROPS an alias two teams claim instead of picking one', () => {
    const sanDiego = team({ id: 301, school: 'San Diego', mascot: 'Toreros' })
    const sanDiegoState = team({ id: 21, school: 'San Diego State', mascot: 'Aztecs', alternateNames: ['San Diego'] })
    const ix = buildCollegeTeamIndex([sanDiego, sanDiegoState])

    // Both claim "san diego" — one as its school, one as an alternate name.
    expect(ix.ambiguous.get('san diego')).toBe(2)
    expect(resolveCollegeTeam('San Diego', ix), 'guessed between two schools').toBeNull()

    // The unambiguous forms still work, so dropping costs only the collision.
    expect(resolveCollegeTeam('San Diego State', ix)?.id).toBe(21)
    expect(resolveCollegeTeam('San Diego Toreros', ix)?.id).toBe(301)
  })

  it('does not prefer FBS when an alias is contested', () => {
    // Preferring the "more important" team is exactly how a scoreboard shows
    // the wrong crest and nobody notices for a season.
    const fbs = team({ id: 1, school: 'Miami', classification: 'fbs' })
    const fcs = team({ id: 2, school: 'Miami', classification: 'fcs' })
    const ix = buildCollegeTeamIndex([fbs, fcs])
    expect(resolveCollegeTeam('Miami', ix)).toBeNull()
  })

  it('handles empty and junk input without throwing', () => {
    expect(resolveCollegeTeam('', index)).toBeNull()
    expect(resolveCollegeTeam(null, index)).toBeNull()
    expect(resolveCollegeTeam('   ', index)).toBeNull()
  })
})
