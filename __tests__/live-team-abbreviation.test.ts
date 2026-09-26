import { describe, expect, it } from 'vitest'
import { liveTeamAbbreviation } from '@/lib/live/teamAbbreviation'

describe('sport-specific scoreboard identities', () => {
  it('retains MLB, WNBA and college identities that collide with NFL aliases', () => {
    expect(liveTeamAbbreviation('STL', 'MLB')).toBe('STL')
    expect(liveTeamAbbreviation('OAK', 'MLB')).toBe('OAK')
    expect(liveTeamAbbreviation('LA', 'WNBA')).toBe('LA')
    expect(liveTeamAbbreviation('WSH', 'WNBA')).toBe('WSH')
    expect(liveTeamAbbreviation('TAM', 'NCAAF')).toBe('TAM')
  })
  it('keeps the canonical NFL identities used to join roster scores', () => {
    expect(liveTeamAbbreviation('STL', 'NFL')).toBe('LAR')
    expect(liveTeamAbbreviation('JAC', 'NFL')).toBe('JAX')
  })
})
