import { describe, expect, it } from 'vitest'
import { decisionFormatBlock, leagueForbidsTrades } from '@/lib/chimmy/decisionFormatGate'

/*
 * Rows shaped as production stores them (read-only query, 2026-09-28). The corpus in
 * `__tests__/chimmy-eval/decision.test.ts` scores the gate end to end; this pins the predicate.
 */
const row = (over: Partial<Parameters<typeof decisionFormatBlock>[0]> = {}) => ({
  leagueType: 'redraft', isDynasty: false, settings: {}, bestBallMode: false, ...over,
})

describe('decisionFormatBlock', () => {
  it.each([
    ['redraft best ball', row({ bestBallMode: true })],
    ['dynasty IDP best ball, the shape no format test can see', row({ leagueType: 'dynasty', isDynasty: true, bestBallMode: true })],
  ])('refuses a lineup move in %s', (_name, league) => {
    expect(decisionFormatBlock(league, 'lineup')?.code).toBe('best_ball_auto_lineup')
  })

  it.each(['trade', 'waiver'] as const)('leaves a best-ball %s alone: those permissions are unverified, not absent', (kind) => {
    expect(decisionFormatBlock(row({ bestBallMode: true }), kind)).toBeNull()
  })

  /* The catalog says "no trades" for exactly these. Production: 1 survivor-guillotine, 18 tournament. */
  it.each([
    ['survivor guillotine, confirmed on a guillotine chassis', row({ leagueType: 'guillotine', settings: { leagueTypeConfirmation: { type: 'survivor_guillotine' } } }), 'no trades'],
    ['tournament, confirmed', row({ leagueType: 'tournament', settings: { leagueTypeConfirmation: { type: 'tournament' } } }), 'not rosters that trade'],
    ['tournament by stored type', row({ leagueType: 'tournament' }), 'not rosters that trade'],
  ])('refuses a trade in %s, with the catalog\'s reason', (_name, league, reason) => {
    expect(leagueForbidsTrades(league)).toBe(true)
    const block = decisionFormatBlock(league, 'trade')
    expect(block?.code).toBe('trades_not_allowed')
    expect(block?.detail).toContain(reason)
  })

  /*
   * 🛑 THE FIRST VERSION REFUSED ALL FOUR OF THESE, copying the Player Finder's guillotine/survivor test.
   * The catalog says trading is legal in both formats (16 production leagues).
   */
  it.each([
    ['guillotine by stored type', row({ leagueType: 'guillotine' })],
    ['guillotine confirmed in settings', row({ leagueType: 'guillotine', settings: { leagueTypeConfirmation: { type: 'guillotine' } } })],
    ['survivor', row({ leagueType: 'survivor' })],
    // The catalog's best-ball entry says "typically draft-and-hold"; best-ball permissions are unverified.
    ['best ball by stored type', row({ leagueType: 'best_ball' })],
  ])('answers a trade in %s: legal per the catalog, or (best ball) unverified', (_name, league) => {
    expect(leagueForbidsTrades(league)).toBe(false)
    expect(decisionFormatBlock(league, 'trade')).toBeNull()
  })

  it.each(['waiver', 'lineup'] as const)('leaves a survivor-guillotine %s alone', (kind) => {
    expect(decisionFormatBlock(row({ leagueType: 'guillotine', settings: { leagueTypeConfirmation: { type: 'survivor_guillotine' } } }), kind)).toBeNull()
  })

  it.each([
    ['redraft', row()],
    ['dynasty', row({ leagueType: 'dynasty', isDynasty: true })],
  ])('blocks nothing in a %s league', (_name, league) => {
    expect(decisionFormatBlock(league, 'trade')).toBeNull()
    expect(decisionFormatBlock(league, 'lineup')).toBeNull()
    expect(decisionFormatBlock(league, 'waiver')).toBeNull()
  })

  /* Route tests mock the snapshot with only an id. The route calls this on every question. */
  it('does not throw on a snapshot missing every format field', () => {
    const bare = { leagueType: undefined, isDynasty: undefined, settings: undefined } as unknown as Parameters<typeof leagueForbidsTrades>[0]
    expect(leagueForbidsTrades(bare)).toBe(false)
  })
})
