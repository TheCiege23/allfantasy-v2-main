import { describe, expect, it } from 'vitest'
import {
  SCHEDULED_REDRAFT_SPORTS,
  startsAtScheduledTimeRegardlessOfAutostart as starts,
} from '@/lib/draft/redraftScheduledStart'

const REDRAFT = {
  sport: 'NFL', leagueType: 'redraft', isDynasty: false, platform: 'allfantasy',
  survivorMode: false, guillotineMode: false, leagueVariant: null,
}

describe('startsAtScheduledTimeRegardlessOfAutostart', () => {
  it('is true for a native NFL redraft league', () => {
    expect(starts(REDRAFT)).toBe(true)
  })

  it.each(['NBA', 'NHL', 'MLB'])('is true for a native %s redraft league', (sport) => {
    expect(starts({ ...REDRAFT, sport })).toBe(true)
  })

  it('treats a null platform as native, as the server does', () => {
    expect(starts({ ...REDRAFT, platform: null })).toBe(true)
  })

  it('is false for survivor and guillotine leagues, which still honour the toggle', () => {
    expect(starts({ ...REDRAFT, survivorMode: true })).toBe(false)
    expect(starts({ ...REDRAFT, guillotineMode: true })).toBe(false)
    expect(starts({ ...REDRAFT, leagueVariant: 'guillotine' })).toBe(false)
  })

  it('is false for dynasty and keeper leagues', () => {
    expect(starts({ ...REDRAFT, isDynasty: true })).toBe(false)
    expect(starts({ ...REDRAFT, leagueType: 'dynasty' })).toBe(false)
    expect(starts({ ...REDRAFT, leagueType: 'keeper' })).toBe(false)
  })

  it('is false for an imported league', () => {
    expect(starts({ ...REDRAFT, platform: 'sleeper' })).toBe(false)
    expect(starts({ ...REDRAFT, platform: 'espn' })).toBe(false)
  })

  it('is false for an unsupported sport', () => {
    expect(starts({ ...REDRAFT, sport: 'NCAAF' })).toBe(false)
    expect(starts({ ...REDRAFT, sport: 'SOCCER' })).toBe(false)
  })

  it('is false when the league data is missing, so the toggle stays visible', () => {
    expect(starts(null)).toBe(false)
    expect(starts(undefined)).toBe(false)
    expect(starts({ ...REDRAFT, leagueType: undefined })).toBe(false)
    expect(starts({ ...REDRAFT, isDynasty: undefined })).toBe(false)
    expect(starts({ ...REDRAFT, sport: undefined })).toBe(false)
  })

  it('covers exactly the four redraft sports', () => {
    expect([...SCHEDULED_REDRAFT_SPORTS].sort()).toEqual(['MLB', 'NBA', 'NFL', 'NHL'])
  })
})
