import { describe, expect, it } from 'vitest'
import {
  LEAGUE_FIRST_FLAG,
  isLeagueFirstEnabled,
  parseLeagueFirstToggle,
  resolveLeagueFirstLanding,
} from '@/lib/core-app/leagueFirst'
import { bucketFor } from '@/lib/sports-os/rollout'

describe('parseLeagueFirstToggle', () => {
  it('reads on/off in the forms a person types', () => {
    expect(parseLeagueFirstToggle('on')).toBe('on')
    expect(parseLeagueFirstToggle(' ON ')).toBe('on')
    expect(parseLeagueFirstToggle('1')).toBe('on')
    expect(parseLeagueFirstToggle('off')).toBe('off')
    expect(parseLeagueFirstToggle('false')).toBe('off')
  })
  it('has no opinion on anything else', () => {
    expect(parseLeagueFirstToggle(undefined)).toBeNull()
    expect(parseLeagueFirstToggle('')).toBeNull()
    expect(parseLeagueFirstToggle('maybe')).toBeNull()
  })
})

describe('isLeagueFirstEnabled', () => {
  it('is off for everyone by default', () => {
    expect(isLeagueFirstEnabled({ userId: 'u1', cookieValue: undefined, rolloutEnv: undefined })).toBe(false)
  })
  it('turns on for one browser with the cookie', () => {
    expect(isLeagueFirstEnabled({ userId: 'u1', cookieValue: 'on', rolloutEnv: undefined })).toBe(true)
  })
  it('lets the cookie opt a user back out of a full rollout', () => {
    expect(isLeagueFirstEnabled({ userId: 'u1', cookieValue: 'on', rolloutEnv: '100' })).toBe(true)
    expect(isLeagueFirstEnabled({ userId: 'u1', cookieValue: 'off', rolloutEnv: '100' })).toBe(false)
  })
  it('follows the rollout env without a cookie, allowlist included', () => {
    expect(isLeagueFirstEnabled({ userId: 'u1', cookieValue: undefined, rolloutEnv: '100' })).toBe(true)
    expect(isLeagueFirstEnabled({ userId: 'u1', cookieValue: undefined, rolloutEnv: '0|u1' })).toBe(true)
    expect(isLeagueFirstEnabled({ userId: 'u2', cookieValue: undefined, rolloutEnv: '0|u1' })).toBe(false)
    expect(isLeagueFirstEnabled({ userId: 'u1', cookieValue: undefined, rolloutEnv: 'off' })).toBe(false)
  })
  it('buckets on its own flag name, so a percentage is a real draw', () => {
    // Find one user inside a 50% cohort and one outside it; the flag must honour both.
    const ids = Array.from({ length: 200 }, (_, i) => `user-${i}`)
    const inside = ids.find((id) => bucketFor(LEAGUE_FIRST_FLAG, id) < 5000)!
    const outside = ids.find((id) => bucketFor(LEAGUE_FIRST_FLAG, id) >= 5000)!
    expect(isLeagueFirstEnabled({ userId: inside, cookieValue: undefined, rolloutEnv: '50' })).toBe(true)
    expect(isLeagueFirstEnabled({ userId: outside, cookieValue: undefined, rolloutEnv: '50' })).toBe(false)
  })
})

describe('resolveLeagueFirstLanding', () => {
  const played = ['a', 'b', 'c']
  it('opens the remembered league on its matchup when it has a head-to-head this week', () => {
    expect(
      resolveLeagueFirstLanding({ lastLeagueId: 'b', playedLeagueIds: played, headToHeadLeagueIds: new Set(['b']) }),
    ).toBe('/core/matchup?league=b')
  })
  it('opens the league home when there is no head-to-head (pre-draft, offseason, guillotine)', () => {
    expect(
      resolveLeagueFirstLanding({ lastLeagueId: 'b', playedLeagueIds: played, headToHeadLeagueIds: new Set(['a']) }),
    ).toBe('/core?league=b')
  })
  it('never opens a league the user no longer plays', () => {
    expect(
      resolveLeagueFirstLanding({ lastLeagueId: 'gone', playedLeagueIds: played, headToHeadLeagueIds: new Set(['gone']) }),
    ).toBeNull()
  })
  it('opens the only league when there is nothing remembered yet', () => {
    expect(
      resolveLeagueFirstLanding({ lastLeagueId: null, playedLeagueIds: ['solo'], headToHeadLeagueIds: new Set(['solo']) }),
    ).toBe('/core/matchup?league=solo')
  })
  it('stays on the cross-league home with several leagues and no memory', () => {
    expect(resolveLeagueFirstLanding({ lastLeagueId: null, playedLeagueIds: played, headToHeadLeagueIds: new Set() })).toBeNull()
  })
  it('encodes the id into the URL', () => {
    expect(
      resolveLeagueFirstLanding({ lastLeagueId: 'a b&c', playedLeagueIds: ['a b&c'], headToHeadLeagueIds: new Set() }),
    ).toBe('/core?league=a%20b%26c')
  })
})
