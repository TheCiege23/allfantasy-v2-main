import { describe, expect, it } from 'vitest'

import { parseStandingsDivisions, readFantraxDivisions, STANDINGS_DIVISIONS_KEY } from '@/lib/league-import/standingsDivisions'

describe('Fantrax divisions', () => {
  it('keeps every division of a big league, uneven sizes included', () => {
    // 34 teams in 8 divisions: two of five, six of four.
    const sizes = [5, 5, 4, 4, 4, 4, 4, 4]
    const byTeam: Record<string, string> = {}
    let team = 0
    sizes.forEach((size, d) => { for (let i = 0; i < size; i += 1) byTeam[String(1000 + team++)] = `Division ${d + 1} ` })
    const divisions = readFantraxDivisions(byTeam)
    expect(divisions?.source).toBe('fantrax')
    expect(Object.keys(divisions!.names)).toHaveLength(8)
    expect(Object.keys(divisions!.teams)).toHaveLength(34)
    // Names are trimmed (Fantrax sends "NFC East ").
    expect(divisions!.teams['1000']).toBe('Division 1')
    // It survives the settings round trip.
    expect(parseStandingsDivisions({ [STANDINGS_DIVISIONS_KEY]: divisions })).toEqual(divisions)
  })

  it('reads a league with no divisions, or only one, as having none', () => {
    expect(readFantraxDivisions({})).toBeNull()
    expect(readFantraxDivisions(null)).toBeNull()
    expect(readFantraxDivisions({ a: 'Only', b: 'Only' })).toBeNull()
  })
})
