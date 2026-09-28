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

  it.each([
    ['guillotine by stored type', row({ leagueType: 'guillotine' })],
    ['guillotine confirmed in settings', row({ leagueType: 'guillotine', settings: { leagueTypeConfirmation: { type: 'guillotine' } } })],
    ['survivor guillotine, confirmed', row({ leagueType: 'guillotine', settings: { leagueTypeConfirmation: { type: 'survivor_guillotine' } } })],
    ['survivor', row({ leagueType: 'survivor' })],
  ])('refuses a trade in %s', (_name, league) => {
    expect(leagueForbidsTrades(league)).toBe(true)
    expect(decisionFormatBlock(league, 'trade')?.code).toBe('trades_not_allowed')
  })

  it.each(['waiver', 'lineup'] as const)('leaves a guillotine %s alone', (kind) => {
    expect(decisionFormatBlock(row({ leagueType: 'guillotine' }), kind)).toBeNull()
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
