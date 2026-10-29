import { shouldVerifyCurrentNbaRoster } from '@/lib/draft-room/nbaSurvivorRosterEligibility'
import { describe, expect, it } from 'vitest'
import {
  buildNbaRosterEligibility,
  nbaSurvivorPlayerIdMatches,
  nbaSurvivorPlayerIsEligible,
  type NbaRosterEvidence,
} from '@/lib/draft-room/nbaSurvivorRosterEligibility'

const now = new Date('2026-10-13T12:00:00.000Z')
const row = (input: Partial<NbaRosterEvidence> & Pick<NbaRosterEvidence, 'name' | 'source' | 'status'>): NbaRosterEvidence => ({
  team: 'Denver Nuggets',
  fetchedAt: new Date('2026-10-13T08:00:00.000Z'),
  expiresAt: new Date('2026-10-20T08:00:00.000Z'),
  ...input,
})

describe('NBA Survivor current-roster eligibility', () => {
  it('rejects freshly refreshed historic players while keeping verified active and questionable players', () => {
    const eligibility = buildNbaRosterEligibility([
      row({ name: 'Aaron Brooks', source: 'rolling_insights', status: 'INACT', externalId: 'retired-1' }),
      row({ name: 'Nikola Jokic', source: 'rolling_insights', status: 'ACT', externalId: 'ri-1' }),
      row({ name: 'Jalen Williams', source: 'rolling_insights', status: 'QUES', externalId: 'ri-2' }),
    ], 2, now)
    expect(eligibility.ready).toBe(true)
    expect(nbaSurvivorPlayerIsEligible(eligibility, 'Aaron Brooks')).toBe(false)
    expect(nbaSurvivorPlayerIdMatches(eligibility, 'Nikola Jokić', 'ri-1')).toBe(true)
    expect(nbaSurvivorPlayerIdMatches(eligibility, 'Nikola Jokic', 'retired-1')).toBe(false)
    expect(nbaSurvivorPlayerIsEligible(eligibility, 'Jalen Williams')).toBe(true)
  })

  it('rescues an active player whose other feed labels him inactive and rejects known free agents', () => {
    const eligibility = buildNbaRosterEligibility([
      row({ name: 'Bam Adebayo', source: 'rolling_insights', status: 'INACT', externalId: 'ri-bam' }),
      row({ name: 'Bam Adebayo', source: 'thesportsdb', status: 'Active', externalId: 'tsdb-bam' }),
      row({ name: 'Example Free Agent', source: 'rolling_insights', status: 'ACT', externalId: 'ri-fa' }),
      row({ name: 'Example Free Agent', source: 'thesportsdb', status: 'Free Agent', externalId: 'tsdb-fa' }),
    ], 1, now)
    expect(nbaSurvivorPlayerIdMatches(eligibility, 'Bam Adebayo', 'ri-bam')).toBe(true)
    expect(nbaSurvivorPlayerIdMatches(eligibility, 'Bam Adebayo', 'tsdb-bam')).toBe(true)
    expect(nbaSurvivorPlayerIsEligible(eligibility, 'Example Free Agent')).toBe(false)
  })

  it('fails closed when the roster is stale or smaller than the scheduled draft', () => {
    const eligibility = buildNbaRosterEligibility([
      row({ name: 'Old Player', source: 'thesportsdb', status: 'Active', fetchedAt: new Date('2026-10-08T08:00:00.000Z') }),
      row({ name: 'Current Player', source: 'rolling_insights', status: 'ACT', externalId: 'ri-current' }),
    ], 2, now)
    expect(eligibility.ready).toBe(false)
    expect(nbaSurvivorPlayerIdMatches(eligibility, 'Current Player', 'ri-current')).toBe(false)
    expect(eligibility.reason).toMatch(/current NBA roster/i)
  })
})


describe('current NBA roster protection by draft format', () => {
  it.each([
    ['NBA', 'redraft', false, false, false, false, true],
    ['NBA', null, false, false, false, false, true],
    ['NBA', 'survivor', false, false, false, false, true],
    ['NBA', 'dynasty', true, false, false, false, false],
    ['NBA', 'dynasty', false, false, false, false, false],
    ['NBA', 'devy', true, true, false, true, false],
    ['NBA', 'c2c', false, false, true, true, false],
    ['NFL', 'redraft', false, false, false, false, false],
  ])('%s %s selects the appropriate roster guard', (sport, variant, isDynasty, isDevy, isC2C, mergeCollegePool, expected) => {
    expect(shouldVerifyCurrentNbaRoster({ sport: String(sport), variant: variant as string | null, isDynasty: Boolean(isDynasty), isDevy: Boolean(isDevy), isC2C: Boolean(isC2C), mergeCollegePool: Boolean(mergeCollegePool) })).toBe(expected)
  })
})
