/**
 * 🛑 ESPN manager names were stored as raw SWID GUIDs.
 *
 * A public ESPN league read without cookies often carries no `members` array, so
 * `resolveEspnOwners` could not look an owner id up and fell back to the id itself. Every team
 * of two imported leagues on the test DB showed `ownerName = '{EC0584BF-CB80-42E1-BC67-…}'`.
 *
 * Only the DISPLAY name changes. `managerId` stays the raw owner id — it is a join key
 * (claims, `platformUserId`, the viewer-team match) and must not be prettified.
 */
import { describe, expect, it } from 'vitest'

import { resolveEspnOwnersForTest as resolveEspnOwners } from '@/lib/league-import/espn/EspnLeagueFetchService'

const GUID = '{EC0584BF-CB80-42E1-BC67-4C9D746F1A39}'
const NO_MEMBERS = new Map<string, { id: string; displayName: string }>()

describe('ESPN owner display name never falls back to a GUID', () => {
  it('uses the member’s real name when the directory has one', () => {
    const members = new Map([[GUID, { id: GUID, displayName: 'Alice' }]])
    expect(resolveEspnOwners({ id: 3, owners: [GUID], location: 'Gotham', nickname: 'Knights' }, members)).toEqual({
      managerId: GUID,
      managerName: 'Alice',
    })
  })

  it('no members: falls back to the team’s own location + nickname, and keeps the id', () => {
    expect(resolveEspnOwners({ id: 3, owners: [GUID], location: 'Gotham', nickname: 'Knights' }, NO_MEMBERS)).toEqual({
      managerId: GUID,
      managerName: 'Gotham Knights',
    })
  })

  it('no members, name-only team: uses team.name', () => {
    expect(resolveEspnOwners({ id: 3, owners: [GUID], name: 'The Squad' }, NO_MEMBERS).managerName).toBe('The Squad')
  })

  it('no members and no team name: `Manager <team id>`', () => {
    expect(resolveEspnOwners({ id: 3, owners: [GUID] }, NO_MEMBERS)).toEqual({
      managerId: GUID,
      managerName: 'Manager 3',
    })
  })

  it('a member row with no name (the directory stores the id as its name) is not a name', () => {
    const members = new Map([[GUID, { id: GUID, displayName: GUID }]])
    expect(resolveEspnOwners({ id: 5, owners: [GUID], name: 'Five' }, members).managerName).toBe('Five')
  })

  it('an owner object with an id and no name is not a name either', () => {
    expect(resolveEspnOwners({ id: 7, owners: [{ id: GUID }] }, NO_MEMBERS)).toEqual({
      managerId: GUID,
      managerName: 'Manager 7',
    })
  })

  it('no owners at all, only primaryOwner: id preserved, no GUID in the name', () => {
    const result = resolveEspnOwners({ id: 2, primaryOwner: GUID, abbrev: 'TWO' }, NO_MEMBERS)
    expect(result.managerId).toBe(GUID)
    expect(result.managerName).toBe('TWO')
  })

  it('co-owners with real names are still joined', () => {
    const other = '{11111111-2222-3333-4444-555555555555}'
    const members = new Map([
      [GUID, { id: GUID, displayName: 'Alice' }],
      [other, { id: other, displayName: 'Bob' }],
    ])
    expect(resolveEspnOwners({ id: 1, owners: [GUID, other] }, members).managerName).toBe('Alice / Bob')
  })
})
