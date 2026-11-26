// @vitest-environment node
/**
 * Devy / C2C college players are listed under CFBD ("Alabama") or ESPN ("Syracuse Orange") school names,
 * and `DevyPlayer.conference` is empty, so their conference comes from a crosswalk
 * (lib/college/devySchoolConferences.ts). The rows below are production's, read 2026-11-25.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { collegeScopeSportFor } from '@/lib/college/conferenceScope'
import { devySchoolsInScope, indexNcaafDevySchools, majorityConference } from '@/lib/college/devySchoolConferences'

const cfbd = [
  { name: 'Alabama', shortName: 'ALA' },
  { name: 'Miami', shortName: 'MIA' },
  { name: 'Boise State', shortName: 'BOIS' }, // Rolling Insights calls it BSU
  { name: 'Notre Dame', shortName: 'ND' },
]
const ri = [
  { name: 'University of Alabama', shortName: 'ALA', conference: 'Southeastern Conference' },
  { name: 'University of Miami', shortName: 'MIA', conference: 'Atlantic Coast Conference' },
  { name: 'Miami University', shortName: 'M-OH', conference: 'Mid-American Conference' },
  { name: 'Boise State University', shortName: 'BSU', conference: 'Pac-12 Conference' },
  { name: 'University of Notre Dame', shortName: 'ND', conference: 'Independent' },
]

describe('college football devy schools', () => {
  const conferenceOf = indexNcaafDevySchools(cfbd, ri)

  it('goes by team code first: "Miami" is the ACC school, not Miami University in the MAC', () => {
    expect(conferenceOf('Miami')).toBe('Atlantic Coast Conference')
    expect(conferenceOf('Alabama')).toBe('Southeastern Conference')
  })

  it('falls back to the full name when the two sources use different codes', () => {
    expect(conferenceOf('Boise State')).toBe('Pac-12 Conference')
  })

  it('leaves a school it cannot place unplaced', () => {
    expect(conferenceOf('Nowhere Tech')).toBeNull()
    expect(conferenceOf('  ')).toBeNull()
  })
})

describe('college basketball devy schools', () => {
  it("takes the conference most of a school's players are linked to, so one transfer cannot move it", () => {
    const map = majorityConference([
      { school: 'Syracuse Orange', conference: 'Atlantic Coast Conference', n: 12 },
      { school: 'Syracuse Orange', conference: 'Big East Conference', n: 2 },
      { school: 'Gonzaga Bulldogs', conference: 'West Coast Conference', n: 14 },
    ])
    expect(map.get('Syracuse Orange')).toBe('Atlantic Coast Conference')
    expect(map.get('Gonzaga Bulldogs')).toBe('West Coast Conference')
  })
})

describe('which devy schools a scope admits', () => {
  const schools = new Map([
    ['Alabama', 'Southeastern Conference'],
    ['Miami', 'Atlantic Coast Conference'],
    ['Boise State', 'Pac-12 Conference'],
    ['Notre Dame', 'Independent'],
    ['East Tennessee State', 'Independent'],
  ])

  it('Power 4 takes Notre Dame by name, and not the other independent', () => {
    expect(devySchoolsInScope('NCAAF', { preset: 'power', conferences: [] }, schools)).toEqual(['Alabama', 'Miami', 'Notre Dame'])
  })

  it('a custom list takes exactly those conferences', () => {
    expect(devySchoolsInScope('NCAAF', { preset: 'custom', conferences: ['Pac-12 Conference'] }, schools)).toEqual(['Boise State'])
  })

  it('applies no filter when no school could be placed, rather than emptying the college pool', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(devySchoolsInScope('NCAAF', { preset: 'power', conferences: [] }, new Map())).toBeNull()
    warn.mockRestore()
  })

  it('maps a league to the college sport its scope names', () => {
    expect(collegeScopeSportFor('NFL')).toBe('NCAAF')
    expect(collegeScopeSportFor('NBA')).toBe('NCAAB')
    expect(collegeScopeSportFor('NCAAF')).toBe('NCAAF')
    expect(collegeScopeSportFor('MLB')).toBeNull()
  })
})
