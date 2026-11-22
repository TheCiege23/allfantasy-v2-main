/**
 * The Round 1 announcement line knows every sport's positions, and a Survivor draft lights the
 * island's first torch. The overlay used to know football only.
 */
import { describe, expect, it } from 'vitest'
import { roundOneHypeLine } from '@/lib/draft-room/roundOneHypeLine'

describe('roundOneHypeLine', () => {
  it('keeps the football copy', () => {
    expect(roundOneHypeLine({ sport: 'NFL', position: 'QB' })).toBe('Commanding the board early with a field general.')
    expect(roundOneHypeLine({ sport: 'NCAAF', position: 'RB' })).toBe('Ground game priority set for the draft room.')
    expect(roundOneHypeLine({ sport: 'NFL', position: 'K' })).toBe('Opening statement pick locked in.')
  })

  it('speaks basketball, hockey and baseball', () => {
    expect(roundOneHypeLine({ sport: 'NBA', position: 'PG' })).toBe('A floor general takes the first spotlight.')
    expect(roundOneHypeLine({ sport: 'nba', position: 'c' })).toBe('Anchoring the paint from pick one.')
    expect(roundOneHypeLine({ sport: 'NHL', position: 'D' })).toBe('A franchise blueliner goes early.')
    expect(roundOneHypeLine({ sport: 'NHL', position: 'G' })).toBe('A starting goalie before anyone blinks.')
    expect(roundOneHypeLine({ sport: 'MLB', position: 'SP' })).toBe('An ace takes the mound in Round 1.')
    expect(roundOneHypeLine({ sport: 'MLB', position: 'SS' })).toBe('A lineup cornerstone is locked in.')
  })

  it('lights the first torch for a Survivor draft', () => {
    expect(roundOneHypeLine({ sport: 'NBA', position: 'SF', formatType: 'survivor' })).toBe('A wing with star upside is off the board. The first torch on the island is lit.')
    expect(roundOneHypeLine({ sport: 'NBA', position: 'SF', formatType: 'redraft' })).toBe('A wing with star upside is off the board.')
  })
})
