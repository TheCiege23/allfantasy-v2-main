import { describe, expect, it } from 'vitest'
import { bestBallCoverage, lineupActionability } from '../lib/core-app/lineupActionability'

describe('league-aware lineup alerts', () => {
  const normal = { stage: 'in_season', emptyStarters: 5, hurtStarters: 2 }
  it('never urges lineup changes before the draft or after elimination', () => {
    for (const stage of ['pre_draft', 'setup', 'drafting', 'completed']) {
      expect(lineupActionability({ ...normal, stage }).emptyStarters).toBe(0)
      expect(lineupActionability({ ...normal, stage }).hurtStarters).toBe(0)
    }
    expect(lineupActionability({ ...normal, eliminated: true }).hurtStarters).toBe(0)
  })
  it('retains actionable managed-lineup holes', () => {
    expect(lineupActionability(normal)).toMatchObject({ emptyStarters: 5, hurtStarters: 2 })
  })
  it('uses the whole eligible best ball roster instead of its displayed starters', () => {
    const result = lineupActionability({ ...normal, bestBall: true, waiversEnabled: true, slots: ['QB', 'SUPER_FLEX'],
      players: [{ id: 'injured', position: 'QB', unavailable: true }, { id: 'bench1', position: 'QB' }, { id: 'bench2', position: 'WR' }] })
    expect(result).toMatchObject({ emptyStarters: 0, hurtStarters: 0, needsWaivers: false, bestBallMissing: [] })
  })
  it('does not reuse one player across QB and superflex, or count IR/taxi/bye players', () => {
    expect(bestBallCoverage(['QB', 'SUPER_FLEX'], [{ id: '1', position: 'QB' }]).missing).toHaveLength(1)
    expect(bestBallCoverage(['QB'], [{ id: '1', position: 'QB', inactive: true }, { id: '2', position: 'QB', bye: true }]).missing).toEqual(['QB'])
  })
  it('reassigns flex coverage without stealing the only positional starter', () => {
    expect(bestBallCoverage(['FLEX', 'RB'], [{ id: 'rb', position: 'RB' }, { id: 'wr', position: 'WR' }]).missing).toEqual([])
  })
  it('only asks for waivers when roster coverage fails and additions are allowed', () => {
    const input = { ...normal, bestBall: true, slots: ['QB'], players: [{ id: '1', position: 'QB', unavailable: true }] }
    expect(lineupActionability({ ...input, waiversEnabled: true }).needsWaivers).toBe(true)
    expect(lineupActionability({ ...input, waiversEnabled: false }).needsWaivers).toBe(false)
    expect(lineupActionability(input).needsWaivers).toBe(false)
  })
})
