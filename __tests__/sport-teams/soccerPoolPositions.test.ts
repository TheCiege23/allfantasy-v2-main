/**
 * Rolling Insights sends soccer positions as words. The draft accepts only GKP / DEF / MID / FWD, so an
 * unmapped word dropped the player: a new soccer league's pool held one player (2026-11-27).
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { normalizePoolPosition } from '@/lib/sport-teams/SportPlayerPoolResolver'

describe('soccer pool positions', () => {
  it.each([
    ['Defender', 'DEF'], ['Midfielder', 'MID'], ['Forward', 'FWD'], ['Goalkeeper', 'GKP'],
    ['GK', 'GKP'], ['FWD', 'FWD'], ['def', 'DEF'], [' Attacker ', 'FWD'],
  ])('%s → %s', (raw, want) => {
    expect(normalizePoolPosition('SOCCER', raw)).toBe(want)
  })

  it('leaves other sports alone: "Forward" in basketball is not a soccer FWD', () => {
    expect(normalizePoolPosition('NBA', 'Forward')).toBe('FORWARD')
    expect(normalizePoolPosition('NHL', 'C')).toBe('C')
  })
})
