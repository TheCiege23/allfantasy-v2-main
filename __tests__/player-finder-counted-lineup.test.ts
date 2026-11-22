import { describe, expect, it } from 'vitest'
import { countedLineupReplacementIsLegal } from '@/lib/core-app/countedLineupSwap'
import { playerNamesAgree } from '@/lib/player-identity/externalIdNamespace'

const settings = { roster_positions: ['RB:2', 'QB:1', 'TE:1', 'SUPER_FLEX:1', 'WR:2', 'FLEX:3', 'BN:25'] }
// The claimed Fantrax roster's provider order differs from the counted slot order.
const starters = ['RB', 'WR', 'TE', 'QB', 'WR', 'TE', 'TE', 'QB', 'RB', 'RB']
const legal = (replacedIndex: number, candidatePosition: string | null, positions = starters) =>
  countedLineupReplacementIsLegal({ sport: 'NCAAF', settings, starterPositions: positions,
    replacedIndex, candidatePosition })

describe('Player Finder counted Fantrax lineups', () => {
  it('proves a legal swap against the entire lineup without trusting starter order', () => {
    expect(legal(3, 'QB')).toBe(true)
    expect(legal(8, 'WR')).toBe(true)
    expect(legal(1, 'QB')).toBe(false) // three QBs cannot fit QB plus superflex
  })

  it('refuses unknown positions, malformed slot counts, and an invalid source lineup', () => {
    expect(legal(3, null)).toBe(false)
    expect(legal(3, 'QB', starters.map((p, i) => i === 1 ? null : p) as string[])).toBe(false)
    expect(legal(3, 'QB', starters.map((p, i) => i === 1 ? 'QB' : p))).toBe(false)
    expect(countedLineupReplacementIsLegal({ sport: 'NCAAF',
      settings: { roster_positions: ['QB:1', 'RB:bad', 'BN:1'] },
      starterPositions: ['QB', 'RB'], replacedIndex: 0, candidatePosition: 'QB' })).toBe(false)
  })

  it('accepts only the independently verified Coastal Carolina name variant', () => {
    expect(playerNamesAgree('Dominic Knicely', 'Dominic Lee-Knicely')).toBe(true)
    expect(playerNamesAgree('Dominic Lee-Knicely', 'Dominic Knicely')).toBe(true)
    expect(playerNamesAgree('Dominic Knicely', 'Dominic Lee')).toBe(false)
  })
})
