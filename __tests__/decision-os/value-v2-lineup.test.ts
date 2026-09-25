import { expect, it } from 'vitest'
import { marginalLineup, marginalOutcomeProbability, optimalLineup } from '@/lib/decision-os/value-v2/lineup'

const player = (id: string, positions: string[], points: number | null) => ({ id, positions, points, available: true })
const slots = [{ id: 'FLEX', count: 1, eligiblePositions: ['RB', 'WR'] }, { id: 'RB', count: 1, eligiblePositions: ['RB'] }]
it('reassigns the strongest RB out of flex instead of stranding the WR', () => {
  const result = optimalLineup([player('RB', ['RB'], 20), player('WR', ['WR'], 19), player('bench', ['RB'], 1)], slots)
  expect(result?.points).toBe(39)
  expect(result?.assignments.find(a => a.slotId === 'RB:0')?.playerId).toBe('RB')
})
it('uses a multi-position player once and handles IDP/K slots', () => {
  const result = optimalLineup([player('edge', ['LB', 'DL'], 10), player('k', ['K'], 8)], [
    { id: 'LB', count: 1, eligiblePositions: ['LB'] }, { id: 'DL', count: 1, eligiblePositions: ['DL'] }, { id: 'K', count: 1, eligiblePositions: ['K'] },
  ])
  expect(result?.points).toBe(18)
  expect(result?.assignments.filter(a => a.playerId === 'edge')).toHaveLength(1)
})
it('returns unknown for an eligible player without projections', () => {
  expect(optimalLineup([player('RB', ['RB'], null)], slots)).toBeNull()
  expect(optimalLineup([{ ...player('RB', ['RB'], null), available: false }], slots)?.points).toBe(0)
})
it('computes add/drop benefit against the optimal lineup and enforces locks/capacity', () => {
  const input = { roster: [player('RB', ['RB'], 20), player('WR', ['WR'], 10)], add: [player('new', ['WR'], 15)],
    dropIds: ['WR'], slots, rosterCapacity: 2 }
  expect(marginalLineup(input)?.pointsDelta).toBe(5)
  expect(marginalLineup({ ...input, dropIds: [] })).toBeNull()
  expect(marginalLineup({ ...input, lockedPlayerIds: ['WR'] })).toBeNull()
})
it('does not mistake a bench upgrade for a starting lineup upgrade', () => {
  expect(marginalLineup({ roster: [player('RB', ['RB'], 20), player('WR', ['WR'], 19), player('bench', ['RB'], 2)],
    add: [player('new', ['RB'], 5)], dropIds: ['bench'], slots, rosterCapacity: 3 })?.pointsDelta).toBe(0)
})
it('reports paired simulation deltas separately from point or market units', () => {
  expect(marginalOutcomeProbability([{ id: 'a', before: false, after: true }, { id: 'b', before: true, after: true }])).toEqual({ before: 0.5, after: 1, delta: 0.5, sampleSize: 2 })
  expect(marginalOutcomeProbability([])).toBeNull()
})
