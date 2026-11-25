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
  it('keeps an INACT player whom two providers both confirm on a current roster', () => {
    // Production 2026-11-25: RI INACT, Sleeper ACT (club code), TheSportsDB Active (club name).
    const ri = row({ status: 'INACT', position: 'PF', dob: '1994-12-06' })
    const sleeper = row({ id: 'sl:1', source: 'sleeper', status: 'ACT', team: 'CUR', position: 'PF', dob: '1994-12-06' })
    const tsdb = row({ id: 'tsdb:1', source: 'thesportsdb', status: 'Active', position: 'Power Forward', dob: '1994-12-06' })
    for (const sport of ['NBA', 'NHL', 'MLB']) {
      const result = reconcileCurrentProRows(sport, [ri], [ri, sleeper, tsdb], true, now)
      expect(result).toHaveLength(1); expect(result[0]?.id).toBe('ri:1')
      // Membership only: with two providers matching, neither one rewrites the position.
      expect(result[0]?.position).toBe('PF')
    }
    // One provider confirming is still enough, and it is the only case that supplies a position.
    expect(reconcileCurrentProRows('NBA', [ri], [ri, tsdb], true, now)).toHaveLength(1)
  })
  it('still drops an INACT player when neither confirming provider has them on a roster', () => {
    const ri = row({ status: 'INACT', dob: '1990-01-01' })
    const sleeperFreeAgent = row({ source: 'sleeper', status: 'ACT', team: null, dob: '1990-01-01' })
    const tsdbRetired = row({ source: 'thesportsdb', status: 'Retired', dob: '1990-01-01' })
    expect(reconcileCurrentProRows('NBA', [ri], [ri, sleeperFreeAgent, tsdbRetired], true, now)).toHaveLength(0)
  })
  it('treats two matches from one provider as namesakes even when another provider also matches', () => {
    const ri = row({ status: 'INACT' })
    const tsdb = row({ source: 'thesportsdb', status: 'Active' })
    const sleeper = row({ source: 'sleeper', status: 'ACT' })
    expect(reconcileCurrentProRows('NBA', [ri], [tsdb, tsdb, sleeper], true, now)).toHaveLength(0)
  })
  it('treats a birthday one calendar day apart as the same birthday, and no further', () => {
    // Production 2026-11-25: Joel Embiid is 1994-03-15 on Rolling Insights, 03-16 on Sleeper and TheSportsDB.
    const ri = row({ status: 'INACT', dob: '1994-03-15' })
    const tsdb = row({ source: 'thesportsdb', status: 'Active', dob: '1994-03-16' })
    expect(verifiedRosterMatch(ri, tsdb)).toBe(true)
    expect(reconcileCurrentProRows('NBA', [ri], [ri, tsdb], true, now)).toHaveLength(1)
    expect(verifiedRosterMatch(ri, row({ source: 'thesportsdb', dob: '1994-03-17' }))).toBe(false)
    expect(verifiedRosterMatch(ri, row({ source: 'thesportsdb', dob: 'not a date' }))).toBe(false)
  })
  it('joins a player the providers name differently only through a reviewed bridge that still holds', () => {
    const ri = row({ externalId: '999', name: 'Nicolas Claxton', status: 'INACT', team: 'Chicago Bulls', dob: '1999-04-17' })
    const tsdb = row({ externalId: 'tsdb_34196115', source: 'thesportsdb', name: 'Nic Claxton', status: 'Active', team: 'Chicago Bulls', dob: '1999-04-17' })
    const kept = reconcileCurrentProRows('NBA', [ri], [ri, tsdb], true, now)
    expect(kept).toHaveLength(1); expect(kept[0]?.externalId).toBe('999')
    // Each of these means the stored rows no longer read what was reviewed.
    for (const changed of [{ ...tsdb, name: 'Nicholas Claxton' }, { ...tsdb, dob: '1999-04-18' }, { ...tsdb, externalId: 'tsdb_other' },
      { ...tsdb, team: 'Brooklyn Nets' }, { ...tsdb, status: 'Free Agent' }, { ...tsdb, source: 'sleeper' }]) {
      expect(reconcileCurrentProRows('NBA', [ri], [ri, changed], true, now)).toHaveLength(0)
    }
    expect(reconcileCurrentProRows('NBA', [{ ...ri, name: 'Nic Claxton Jr.' }], [tsdb], true, now)).toHaveLength(0)
    expect(reconcileCurrentProRows('NHL', [ri], [ri, tsdb], true, now)).toHaveLength(0)
  })
  describe('a player with two Rolling Insights profiles', () => {
    const tsdb = row({ source: 'thesportsdb', status: 'Active', dob: '2003-03-17' })
    const ids = (rows: Array<{ id?: string }>) => rows.map((r) => r.id)
    it('keeps the active profile, not the INACT one on the old club', () => {
      // Production 2026-11-25: Dyson Daniels is id 1431 (ACT, Hawks) and id 1432 (INACT, Pelicans).
      const current = row({ id: 'ri:1431', dob: '2003-03-17' })
      const old = row({ id: 'ri:1432', status: 'INACT', team: 'Old Team', dob: '2003-03-17', fetchedAt: new Date(now - 30 * 86400000), expiresAt: new Date(now - 86400000) })
      expect(ids(reconcileCurrentProRows('NBA', [current, old], [current, old, tsdb], true, now))).toEqual(['ri:1431'])
      // Alone, the old profile is this player's only row and the other provider's word still counts.
      expect(ids(reconcileCurrentProRows('NBA', [old], [old, tsdb], true, now))).toEqual(['ri:1432'])
    })
    it('keeps the profile still in the feed over one the feed stopped returning', () => {
      // Production 2026-11-25: Kevin Knox II is id 878 (INACT, in today's feed) and id 1952 (ACT, last returned in October).
      const inFeed = row({ id: 'ri:878', status: 'INACT', dob: '2003-03-17' })
      const gone = row({ id: 'ri:1952', dob: '2003-03-17', fetchedAt: new Date(now - 30 * 86400000), expiresAt: new Date(now - 86400000) })
      expect(ids(reconcileCurrentProRows('NBA', [gone, inFeed], [gone, inFeed, tsdb], true, now))).toEqual(['ri:878'])
    })
    it('drops the INACT second spelling of an active teammate with the same birthday, position and first name', () => {
      const current = row({ id: 'ri:1755', name: 'Yanic Konan Niederhaeuser', dob: '2003-03-17' })
      const spare = row({ id: 'ri:1950', name: 'Yanic Konan Niederhauser', status: 'INACT', dob: '2003-03-17' })
      const sleeper = row({ source: 'sleeper', name: 'Yanic Konan Niederhäuser', status: 'ACT', team: 'CUR', dob: '2003-03-17' })
      expect(ids(reconcileCurrentProRows('NBA', [current, spare], [current, spare, sleeper], true, now))).toEqual(['ri:1755'])
    })
    it('never merges different people: a namesake, or a twin on the same club', () => {
      const current = row({ id: 'ri:1', dob: '2003-03-17' })
      const namesake = row({ id: 'ri:2', status: 'INACT', dob: '1980-01-01' })
      const namesakeProof = row({ source: 'thesportsdb', status: 'Active', dob: '1980-01-01' })
      expect(reconcileCurrentProRows('NBA', [current, namesake], [current, namesake, namesakeProof], true, now)).toHaveLength(2)
      const twin = row({ id: 'ri:3', name: 'Other Player', status: 'INACT', dob: '2003-03-17' })
      const twinProof = row({ source: 'thesportsdb', name: 'Other Player', status: 'Active', dob: '2003-03-17' })
      expect(reconcileCurrentProRows('NBA', [current, twin], [current, twin, twinProof], true, now)).toHaveLength(2)
    })
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

it('does not overwrite a current role with a secondary provider role from the previous club', () => {
  const ri = row({ position: 'PG', dob: '1990-01-01' })
  const oldClub = row({ source: 'thesportsdb', status: 'Active', position: 'SG', team: 'Previous Club', dob: '1990-01-01', imageUrl: 'https://r2.thesportsdb.com/images/media/player/cutout/own.png' })
  const result = reconcileCurrentProRows('NBA', [ri], [ri, oldClub], true, now)[0]!
  expect(result.position).toBe('PG'); expect(result.team).toBe('Current Team')
  expect(result.imageUrl).toBe(oldClub.imageUrl)
})

it.each([['Starting Pitcher', 'SP'], ['Relief Pitcher', 'RP']])('preserves an explicit current MLB %s role', (sourceRole, role) => {
  const ri = row({ position: 'P', dob: '1990-01-01' })
  const secondary = row({ source: 'thesportsdb', status: 'Active', position: sourceRole, dob: '1990-01-01' })
  const result = reconcileCurrentProRows('MLB', [ri], [ri, secondary], true, now)[0]!
  expect(result.position).toBe(role); expect(result.id).toBe('ri:1')
})
