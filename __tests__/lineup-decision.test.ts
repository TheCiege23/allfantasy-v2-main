import { describe, expect, it } from 'vitest'
import { hasStarted, lineupDecision } from '@/lib/core-app/lineupDecision'
import type { LineupPlayer, LineupSlot } from '@/lib/core-app/myTeam'

const now = Date.parse('2026-10-04T18:00:00Z')
const player = (over: Partial<LineupPlayer> = {}) => ({
  name: 'Starter', kickoff: new Date(now + 3600000), afProjectedPoints: 10, ...over,
}) as LineupPlayer
const slot = (over: Partial<LineupSlot> = {}) => ({
  slotLabel: 'WR', player: player(), empty: false, unresolvedId: null, benchCheck: null, ...over,
}) as LineupSlot
const check = { verdict: 'swap' as const, starterName: 'Starter', starterProjected: 10, benchName: 'Bench', benchProjected: 15 }

describe('lineup decision evidence', () => {
  it('recognizes kickoff including serialized dates and the exact boundary', () => {
    expect(hasStarted(player({ kickoff: new Date(now) }), now)).toBe(true)
    expect(hasStarted(player({ kickoff: new Date(now + 1) }), now)).toBe(false)
    expect(hasStarted(player({ kickoff: new Date(now).toISOString() as unknown as Date }), now)).toBe(true)
    expect(hasStarted(player({ kickoff: null }), now)).toBe(false)
    expect(hasStarted(player({ kickoff: new Date('invalid') }), now)).toBe(false)
  })
  it.each(['live', 'final', 'started'] as const)('trusts a known %s game state', state => {
    expect(hasStarted(player({ kickoff: null, gameDay: { state, points: null } }), now)).toBe(true)
  })
  it('prioritizes a remaining empty slot over a past-kickoff out player', () => {
    const played = slot({ player: player({ ruledOut: true, kickoff: new Date(now - 1) }) })
    const empty = slot({ empty: true, player: null })
    expect(lineupDecision([played, empty], [], now).slot).toBe(empty)
  })
  it('retains a started issue for provider lock review when no opportunity remains', () => {
    expect(lineupDecision([slot({ player: player({ ruledOut: true, kickoff: new Date(now - 1) }) })], [], now).started).toBe(true)
  })
  it('does not treat an unresolved identity as an empty slot', () => {
    expect(lineupDecision([slot({ player: null, unresolvedId: 'unknown' })], [], now).slot).toBeNull()
  })
  it('preserves a league-scoring disagreement and checks the bench kickoff', () => {
    const result = lineupDecision([slot({ benchCheck: check })], [player({ name: 'Bench', afProjectedPoints: 8, kickoff: new Date(now) })], now)
    expect(result.delta).toBe(-2)
    expect(result.replacementStarted).toBe(true)
  })
  it('does not assign a league value to an ambiguous name or missing projection', () => {
    const slots = [slot({ benchCheck: check })]
    expect(lineupDecision(slots, [player({ name: 'Bench' }), player({ name: 'Bench' })], now).delta).toBeNull()
    expect(lineupDecision(slots, [player({ name: 'Bench', afProjectedPoints: null })], now).delta).toBeNull()
  })
})
