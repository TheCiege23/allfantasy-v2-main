import { describe, expect, it } from 'vitest'
import { matchStarterSlots } from '@/lib/redraft/nativeDraftRosterTemplate'
import { allowedPositionsForSlot, validateRedraftLineup } from '@/lib/redraft/lineupValidation'
import { resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'

describe('Survivor draft starter assignment', () => {
  it('reassigns flexible seats to fit a later position', () => {
    const seats = [{ allowedPositions: ['PG', 'SG'] }, { allowedPositions: ['PG'] }]
    expect(matchStarterSlots(['PG', 'SG'], seats)).toEqual([1, 0])
  })

  it('puts drafted NBA players into actual G, F and UTIL slots and leaves the rest on the bench', () => {
    const config = resolveRedraftRosterConfig('NBA', null)
    const slots = [...config.starterCapacities].flatMap(([slotName, count]) =>
      Array.from({ length: count }, () => ({ slotName, allowedPositions: allowedPositionsForSlot('NBA', slotName) })))
    const positions = ['C', 'C', 'PF', 'PG', 'SF', 'SG', 'SF', 'PG', 'C', 'C', 'PG', 'PG', 'PG']
    const matching = matchStarterSlots(positions, slots)
    const players = positions.map((position, index) => ({
      playerId: String(index), playerName: `Player ${index}`, position, sport: 'NBA',
      slotType: matching[index] == null ? 'bench' : slots[matching[index]!].slotName,
    }))
    expect(matching.filter(slot => slot !== null)).toHaveLength(slots.length)
    expect(validateRedraftLineup({ sport: 'NBA', week: 1, players, rosterConfig: config }).ok).toBe(true)
  })
})
