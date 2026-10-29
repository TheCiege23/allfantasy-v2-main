import { describe, expect, it } from 'vitest'
import { reconcileCurrentProRows, verifiedRosterMatch, type CurrentProRow } from '@/lib/draft-room/currentProRoster'
const now = Date.UTC(2026, 9, 28)
const row = (patch: Partial<CurrentProRow> & { id?: string } = {}) => ({ id: 'ri:1', name: 'Test Player', source: 'rolling_insights', status: 'ACT', team: 'Current Team', position: 'C', fetchedAt: new Date(now), expiresAt: new Date(now + 86400000), ...patch })
describe('current pro roster reconciliation', () => {
  it.each(['NFL', 'NBA', 'NHL', 'MLB'])('excludes historical INACT profiles in %s redraft', sport => {
    const rows = [row(), row({ name: 'Retired Player', status: 'INACT' })]
    expect(reconcileCurrentProRows(sport, rows, rows, true, now)).toHaveLength(1)
    expect(reconcileCurrentProRows(sport, rows, rows, false, now)).toHaveLength(2)
  })
  it('keeps an injured RI player with verified current roster evidence and preserves the scoring id', () => {
    const ri = row({ status: 'INACT', dob: '1990-01-01' })
    const tsdb = row({ source: 'thesportsdb', status: 'Active', position: 'Power Forward', dob: '1990-01-01', imageUrl: 'https://www.thesportsdb.com/images/media/player/cutout/test.png' })
    const result = reconcileCurrentProRows('NBA', [ri], [ri, tsdb], true, now)[0]!
    expect(result.id).toBe('ri:1'); expect(result.position).toBe('PF'); expect(result.imageUrl).toBe(tsdb.imageUrl)
  })
  it('rejects conflicting birthdays and ambiguous namesakes', () => {
    expect(verifiedRosterMatch(row({ dob: '1999-06-16' }), row({ dob: '1999-01-16' }))).toBe(false)
    const ri = row({ status: 'INACT' })
    const other = row({ source: 'thesportsdb', status: 'Active' })
    expect(reconcileCurrentProRows('NBA', [ri], [other, other], true, now)).toHaveLength(0)
  })
  it('does not restore a free agent team or accept stale roster evidence', () => {
    const ri = row({ team: null, status: 'INACT' })
    const old = row({ source: 'thesportsdb', status: 'Active', fetchedAt: new Date(now - 4 * 86400000) })
    expect(reconcileCurrentProRows('NFL', [ri], [old], true, now)).toHaveLength(0)
  })
  it('does not convert generic position labels into a guessed lineup slot', () => {
    const ri = row({ dob: '1990-01-01' })
    const other = row({ source: 'thesportsdb', status: 'Active', position: 'Forward', dob: '1990-01-01' })
    expect(reconcileCurrentProRows('NBA', [ri], [other], true, now)[0]?.position).toBe('C')
  })
})

it('never restores an NFL free agent team from another provider', () => {
  const sleeper = row({ source: 'sleeper', team: null, status: 'Active', dob: '1990-01-01' })
  const vendor = row({ source: 'thesportsdb', status: 'Active', dob: '1990-01-01' })
  expect(reconcileCurrentProRows('NFL', [sleeper, vendor], [sleeper, vendor], true, now)).toHaveLength(0)
})
it('preserves generational suffixes when a birthday is unavailable', () => {
  expect(verifiedRosterMatch(row({ name: 'Gary Trent' }), row({ name: 'Gary Trent Jr.' }))).toBe(false)
})

it('does not draft a second unscorable SportsDB identity in daily sports', () => {
  const ri = row({ dob: '1990-01-01' })
  const tsdb = row({ source: 'thesportsdb', status: 'Active', position: 'PF', dob: '1990-01-01' })
  const result = reconcileCurrentProRows('NBA', [ri, tsdb], [ri, tsdb], true, now)
  expect(result).toHaveLength(1); expect(result[0]?.source).toBe('rolling_insights')
})

it('retains rostered inactive, practice squad and team-defense Sleeper rows', () => {
  for (const status of ['Inactive', 'Practice Squad', null]) {
    const current = row({ source: 'sleeper', status })
    expect(reconcileCurrentProRows('NFL', [current], [current], true, now)).toHaveLength(1)
  }
  const freeAgent = row({ source: 'sleeper', status: 'Inactive', team: null })
  expect(reconcileCurrentProRows('NFL', [freeAgent], [freeAgent], true, now)).toHaveLength(0)
})

it('uses a verified old photo without accepting a stale free-agent flag as current roster authority', () => {
  const ri = row({ dob: '1990-01-01', status: 'ACT' })
  const oldPhoto = row({ source: 'thesportsdb', status: 'Free Agent', dob: '1990-01-01', team: 'Old Team', imageUrl: 'https://r2.thesportsdb.com/images/media/player/cutout/own.png' })
  const result = reconcileCurrentProRows('NBA', [ri], [ri, oldPhoto], true, now)
  expect(result).toHaveLength(1); expect(result[0]?.imageUrl).toBe(oldPhoto.imageUrl)
  expect(result[0]?.team).toBe('Current Team')
  const retired = row({ dob: '1990-01-01', status: 'INACT' })
  expect(reconcileCurrentProRows('NBA', [retired], [retired, oldPhoto], true, now)).toHaveLength(0)
})

it('preserves the two-way MLB role when a secondary roster lists only pitcher', () => {
  const ri = row({ position: 'TWP', dob: '1990-01-01' })
  const secondary = row({ source: 'thesportsdb', status: 'Active', position: 'P', dob: '1990-01-01' })
  expect(reconcileCurrentProRows('MLB', [ri], [ri, secondary], true, now)[0]?.position).toBe('TWP')
})
