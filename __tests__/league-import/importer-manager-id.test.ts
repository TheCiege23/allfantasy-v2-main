import { describe, expect, it } from 'vitest'
import { importerManagerIdForRosters } from '@/lib/league-import/importerManagerId'

/**
 * 🛑 THE BUG THIS PINS: MFL's gate answers with the caller's FRANCHISE id, but the rosters key each
 * manager on MFL's `owner_id` when the league publishes one. Passed through raw, the importer's id
 * matched no roster, so neither the bootstrap claim nor the cross-account join claimed their team.
 */
const mflRosters = [
  { source_team_id: '0001', source_manager_id: 'owner-aaa' },
  { source_team_id: '0002', source_manager_id: 'owner-bbb' },
  { source_team_id: '0003', source_manager_id: 'owner-ccc' },
]

describe('importerManagerIdForRosters', () => {
  it('translates an MFL franchise id to that team’s owner id', () => {
    expect(importerManagerIdForRosters('mfl', '0002', mflRosters)).toBe('owner-bbb')
  })

  it('matches a franchise id whatever its zero-padding, without Number() coercion', () => {
    expect(importerManagerIdForRosters('MFL', '2', mflRosters)).toBe('owner-bbb')
    expect(importerManagerIdForRosters('mfl', '00003', mflRosters)).toBe('owner-ccc')
  })

  it('keeps the franchise id where the league publishes no owner ids (rosters fell back to it)', () => {
    const noOwners = mflRosters.map((r) => ({ ...r, source_manager_id: r.source_team_id }))
    expect(importerManagerIdForRosters('mfl', '0001', noOwners)).toBe('0001')
  })

  it('keeps the franchise id when the team is missing or has a blank manager', () => {
    expect(importerManagerIdForRosters('mfl', '0009', mflRosters)).toBe('0009')
    expect(importerManagerIdForRosters('mfl', '0001', [{ source_team_id: '0001', source_manager_id: '  ' }])).toBe(
      '0001',
    )
  })

  it('passes every other provider through untouched — their gates already answer in roster keys', () => {
    for (const p of ['sleeper', 'espn', 'yahoo', 'fleaflicker', 'fantrax']) {
      expect(importerManagerIdForRosters(p, '0002', mflRosters)).toBe('0002')
    }
  })

  it('is null when the gate proved no id', () => {
    expect(importerManagerIdForRosters('mfl', null, mflRosters)).toBeNull()
    expect(importerManagerIdForRosters('mfl', '  ', mflRosters)).toBeNull()
  })
})
