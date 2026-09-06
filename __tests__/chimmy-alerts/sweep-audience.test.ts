import { describe, expect, it } from 'vitest'

import { alertPlayerName, injuredStarterDedupeKey, injuredStarterHref, mergeAudience } from '@/lib/chimmy-alerts/sweepAudience'

/*
 * The injured-starter sweep's audience, tap target and dedupe key — the three
 * things that decide whether a flagged starter reaches a person once.
 */

const TOP = { title: 'Dalton Kincaid is Out and still starting', leagueId: 'L-dragons', metadata: { playerName: 'Dalton Kincaid', designation: 'Out' } }
const NOW = new Date('2026-10-25T16:18:00.000Z')

describe('alertPlayerName', () => {
  it('reads the metadata, and falls back to the title the detector writes', () => {
    expect(alertPlayerName(TOP)).toBe('Dalton Kincaid')
    expect(alertPlayerName({ title: 'Mark Andrews is Questionable and still starting' })).toBe('Mark Andrews')
    expect(alertPlayerName({ title: 'Something without the pattern' })).toBeNull()
  })
})

describe('injuredStarterDedupeKey', () => {
  it('is one key per player, per designation, per day', () => {
    expect(injuredStarterDedupeKey(TOP, NOW)).toBe('injured-starter:dalton-kincaid:out:2026-10-25')
    // A downgrade is news: a different designation is a different key the same day.
    expect(injuredStarterDedupeKey({ ...TOP, metadata: { ...TOP.metadata, designation: 'Questionable' } }, NOW)).toBe('injured-starter:dalton-kincaid:questionable:2026-10-25')
    // The same fact tomorrow may go again.
    expect(injuredStarterDedupeKey(TOP, new Date('2026-10-26T12:00:00.000Z'))).toBe('injured-starter:dalton-kincaid:out:2026-10-26')
    // Unlike the old key, two different players in one league on one day are two messages.
    expect(injuredStarterDedupeKey({ ...TOP, metadata: { playerName: 'Mark Andrews', designation: 'Out' } }, NOW)).not.toBe(injuredStarterDedupeKey(TOP, NOW))
  })

  it('falls back to the league when no player can be read', () => {
    expect(injuredStarterDedupeKey({ title: 'no pattern', leagueId: 'L-x' }, NOW)).toBe('injured-starter:L-x:flagged:2026-10-25')
  })
})

describe('injuredStarterHref', () => {
  it('lands on the Player Finder card, which carries the lineup buttons', () => {
    expect(injuredStarterHref(TOP)).toBe('/core/players?q=Dalton%20Kincaid')
    expect(injuredStarterHref({ title: 'no pattern', leagueId: 'L-x' })).toBe('/league/L-x')
    expect(injuredStarterHref({ title: 'no pattern' })).toBe('/my-players')
  })
})

describe('mergeAudience', () => {
  it('puts push subscribers first, adds everyone with a team, dedupes, and caps', () => {
    expect(mergeAudience(['u2', 'u3'], ['u1', 'u2', 'u4', ''], 10)).toEqual(['u2', 'u3', 'u1', 'u4'])
    expect(mergeAudience([], ['u1', 'u2', 'u3'], 2)).toEqual(['u1', 'u2'])
    expect(mergeAudience([], [], 5)).toEqual([])
  })
})
