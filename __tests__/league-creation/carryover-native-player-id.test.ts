import { describe, expect, it } from 'vitest'
import { nativePlayerIdFor } from '@/lib/league-creation/canonical/carryOverImportedLeague'

/* 2026-11-26: an NCAAF carryover read only the Rolling Insights id, and college players are linked by CFBD id. */
describe('nativePlayerIdFor', () => {
  const id = { sleeperId: 'sl1', rollingInsightsId: 'ri1', cfbdId: '4433971' }
  it('NFL keeps the Sleeper id', () => expect(nativePlayerIdFor('NFL', id)).toBe('sl1'))
  it('NCAAF takes the CFBD id first, then RI', () => {
    expect(nativePlayerIdFor('NCAAF', id)).toBe('4433971')
    expect(nativePlayerIdFor('ncaaf', { rollingInsightsId: 'ri2', cfbdId: null })).toBe('ri2')
    expect(nativePlayerIdFor('NCAAF', {})).toBeNull()
  })
  it('[control] every other sport keeps the RI id', () => {
    for (const sport of ['NBA', 'NCAAB', 'MLB', 'NHL']) expect(nativePlayerIdFor(sport, id)).toBe('ri1')
  })
})
