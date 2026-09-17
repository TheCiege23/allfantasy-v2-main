import { describe, expect, it } from 'vitest'
import {
  importedOrphanOwnerKey,
  importedRosterOwnerKey,
  planImportedRosterWrites,
  rosterSourceTeamId,
  type IncomingTeam,
  type StoredRosterRow,
} from '@/lib/league-import/importedRosterIdentity'

const row = (id: string, key: string, teamId: string | null, players = 0): StoredRosterRow => ({
  id,
  platformUserId: key,
  playerData: {
    players: Array.from({ length: players }, (_, i) => `p${i}`),
    ...(teamId ? { source_team_id: teamId } : {}),
  },
})
const team = (teamId: string, ownerKey: string, aliases: string[] = [], keepKey = false): IncomingTeam => ({
  teamId,
  ownerKey,
  ownerAliases: aliases,
  keepKey,
})
const plan = (incoming: IncomingTeam[], stored: StoredRosterRow[]) =>
  planImportedRosterWrites({ provider: 'sleeper', incoming, stored })
const byTeam = (r: ReturnType<typeof plan>) => Object.fromEntries(r.plans.map((p) => [p.teamId, p]))

describe('owner keys', () => {
  it('an orphan gets a key of its own, in the repo orphan convention', () => {
    expect(importedRosterOwnerKey({ provider: 'sleeper', teamId: '5' })).toBe('orphan-sleeper-5')
    expect(importedRosterOwnerKey({ provider: 'sleeper', teamId: '5', sourceManagerId: '  ' })).toBe('orphan-sleeper-5')
    expect(importedOrphanOwnerKey('MFL', '0001')).toBe('orphan-mfl-0001')
  })

  it('🛑 a claimed team keeps its claimant key over the provider id', () => {
    expect(
      importedRosterOwnerKey({ provider: 'sleeper', teamId: '5', claimedByUserId: 'af-user', sourceManagerId: '123' }),
    ).toBe('af-user')
  })

  it('a linked account comes first, then the claim, then the provider id', () => {
    expect(
      importedRosterOwnerKey({ provider: 'sleeper', teamId: '5', linkedUserId: 'af-linked', claimedByUserId: 'af-user', sourceManagerId: '123' }),
    ).toBe('af-linked')
    expect(importedRosterOwnerKey({ provider: 'sleeper', teamId: '5', sourceManagerId: '123' })).toBe('123')
  })

  it('reads the team id from either place an import stores it', () => {
    expect(rosterSourceTeamId({ source_team_id: '3' })).toBe('3')
    expect(rosterSourceTeamId({ source_team_id: 3 })).toBe('3')
    expect(rosterSourceTeamId({ import: { sourceTeamId: '0004' } })).toBe('0004')
    expect(rosterSourceTeamId({ players: [] })).toBeNull()
    expect(rosterSourceTeamId(['p1'])).toBeNull()
    expect(rosterSourceTeamId(null)).toBeNull()
  })
})

describe('🛑 orphan teams no longer share one row', () => {
  it('moves the one stored orphan row to its own key and creates the others', () => {
    // Staging shape: three orphan teams, one '' row (the last one written) bound to team 12.
    const r = plan(
      [team('10', 'orphan-sleeper-10'), team('11', 'orphan-sleeper-11'), team('12', 'orphan-sleeper-12')],
      [row('ra', '', '12', 14), row('rb', 'mgr-1', '1', 15)],
    )
    const p = byTeam(r)
    expect(p['12']).toMatchObject({ rosterId: 'ra', ownerKey: 'orphan-sleeper-12', rekey: true, keyConflict: false })
    expect(p['10']).toMatchObject({ rosterId: null, ownerKey: 'orphan-sleeper-10', keyConflict: false })
    expect(p['11']).toMatchObject({ rosterId: null, ownerKey: 'orphan-sleeper-11', keyConflict: false })
  })

  it('never takes another team\'s row by an empty key', () => {
    const r = plan([team('10', 'orphan-sleeper-10', [''])], [row('ra', '', '12')])
    expect(byTeam(r)['10']).toMatchObject({ rosterId: null })
  })
})

describe('🛑 an owner change moves the row instead of adding one', () => {
  it('re-keys the team\'s row to the new manager', () => {
    const r = plan([team('3', 'mgr-new')], [row('r3', 'mgr-old', '3', 20)])
    expect(byTeam(r)['3']).toMatchObject({ rosterId: 'r3', ownerKey: 'mgr-new', rekey: true })
  })

  it('an orphan that gains a manager keeps its row', () => {
    const r = plan([team('3', 'mgr-new')], [row('r3', 'orphan-sleeper-3', '3')])
    expect(byTeam(r)['3']).toMatchObject({ rosterId: 'r3', ownerKey: 'mgr-new', rekey: true })
  })

  it('a team that loses its manager keeps its row', () => {
    const r = plan([team('3', 'orphan-sleeper-3')], [row('r3', 'mgr-old', '3')])
    expect(byTeam(r)['3']).toMatchObject({ rosterId: 'r3', ownerKey: 'orphan-sleeper-3', rekey: true })
  })

  it('an unchanged team is not re-keyed', () => {
    const r = plan([team('3', 'mgr-1')], [row('r3', 'mgr-1', '3')])
    expect(byTeam(r)['3']).toMatchObject({ rosterId: 'r3', ownerKey: 'mgr-1', rekey: false, keyConflict: false })
  })
})

describe('🛑 a claimed roster is never re-keyed to the provider id', () => {
  it('keeps writing the claimant\'s row, even beside a ghost under the provider id', () => {
    // The ghost is what the old owner-key match created on every sync after an invite claim.
    const r = plan(
      [team('5', 'af-user', ['af-user', 'sleeper-9'])],
      [row('ghost', 'sleeper-9', '5', 30), row('claimed', 'af-user', '5', 30)],
    )
    expect(byTeam(r)['5']).toMatchObject({ rosterId: 'claimed', ownerKey: 'af-user', rekey: false })
    expect(r.duplicateRows).toBe(1)
  })
})

describe('choosing among duplicate rows', () => {
  it('prefers a row under an older key of this owner, then any owner, then the fuller roster', () => {
    const r1 = plan([team('5', 'af-user', ['sleeper-9'])], [row('a', '', '5', 50), row('b', 'sleeper-9', '5', 1)])
    expect(byTeam(r1)['5'].rosterId).toBe('b')
    const r2 = plan([team('5', 'mgr-new')], [row('a', '', '5', 50), row('b', 'mgr-old', '5', 1)])
    expect(byTeam(r2)['5'].rosterId).toBe('b')
    const r3 = plan([team('5', 'mgr-new')], [row('a', 'x1', '5', 1), row('b', 'x2', '5', 9)])
    expect(byTeam(r3)['5'].rosterId).toBe('b')
  })

  it('the row already under the team\'s key wins, even when it is smaller and sorts later', () => {
    const r = plan(
      [team('5', 'af-user', ['af-user', 'sleeper-9'])],
      [row('a-ghost', 'sleeper-9', '5', 40), row('z-claimed', 'af-user', '5', 2)],
    )
    expect(byTeam(r)['5']).toMatchObject({ rosterId: 'z-claimed', rekey: false })
  })

  it('a row under this owner\'s older key beats a fuller row under someone else\'s', () => {
    const r = plan([team('5', 'af-user', ['sleeper-9'])], [row('a', 'mgr-other', '5', 50), row('b', 'sleeper-9', '5', 1)])
    expect(byTeam(r)['5'].rosterId).toBe('b')
  })

  it('breaks a full tie on the lower id, whatever order the rows arrive in', () => {
    const rows = [row('z', 'x1', '5', 3), row('m', 'x2', '5', 3), row('c', 'x3', '5', 3)]
    for (const order of [rows, [...rows].reverse(), [rows[1], rows[2], rows[0]]]) {
      expect(byTeam(plan([team('5', 'mgr-new')], order))['5'].rosterId).toBe('c')
    }
  })
})

describe('keys that pass between rows', () => {
  it('two managers who swapped teams both move, with no conflict', () => {
    const r = plan([team('1', 'mgr-b'), team('2', 'mgr-a')], [row('r1', 'mgr-a', '1'), row('r2', 'mgr-b', '2')])
    expect(byTeam(r)['1']).toMatchObject({ ownerKey: 'mgr-b', rekey: true, keyConflict: false })
    expect(byTeam(r)['2']).toMatchObject({ ownerKey: 'mgr-a', rekey: true, keyConflict: false })
  })

  it('a chain of moves resolves in any order', () => {
    const r = plan([team('2', 'mgr-c'), team('1', 'mgr-b')], [row('r1', 'mgr-a', '1'), row('r2', 'mgr-b', '2')])
    expect(byTeam(r)['1']).toMatchObject({ ownerKey: 'mgr-b', rekey: true })
    expect(byTeam(r)['2']).toMatchObject({ ownerKey: 'mgr-c', rekey: true })
  })

  it('a new row may take the key a moving row gives up', () => {
    const r = plan([team('1', 'mgr-b'), team('2', 'mgr-a')], [row('r1', 'mgr-a', '1')])
    expect(byTeam(r)['2']).toMatchObject({ rosterId: null, ownerKey: 'mgr-a', keyConflict: false })
  })
})

describe('keys this import cannot use', () => {
  it('a key held by a row the import does not move blocks the move, and the row keeps its key', () => {
    const r = plan([team('1', 'mgr-b')], [row('r1', 'mgr-a', '1'), row('stale', 'mgr-b', '9')])
    expect(byTeam(r)['1']).toMatchObject({ rosterId: 'r1', ownerKey: 'mgr-a', rekey: false, keyConflict: true })
  })

  it('a blocked move blocks a move that wanted its key', () => {
    const r = plan(
      [team('1', 'mgr-b'), team('2', 'mgr-a')],
      [row('r1', 'mgr-a', '1'), row('r2', 'mgr-z', '2'), row('stale', 'mgr-b', '9')],
    )
    expect(byTeam(r)['1']).toMatchObject({ ownerKey: 'mgr-a', keyConflict: true })
    expect(byTeam(r)['2']).toMatchObject({ ownerKey: 'mgr-z', rekey: false, keyConflict: true })
  })

  it('one manager on two teams: the first gets the key, the second keeps its own', () => {
    const r = plan([team('1', 'mgr-a'), team('2', 'mgr-a')], [row('r1', 'x1', '1'), row('r2', 'x2', '2')])
    expect(byTeam(r)['1']).toMatchObject({ ownerKey: 'mgr-a', rekey: true })
    expect(byTeam(r)['2']).toMatchObject({ ownerKey: 'x2', rekey: false, keyConflict: true })
  })

  it('a new row whose key is taken goes under the team placeholder instead', () => {
    const r = plan([team('4', 'mgr-b')], [row('stale', 'mgr-b', '9')])
    expect(byTeam(r)['4']).toMatchObject({ rosterId: null, ownerKey: 'import:sleeper:4', keyConflict: true })
  })

  it('a team whose fetch failed keeps its key, and does not free it for anyone', () => {
    const r = plan([team('1', 'mgr-b', [], true), team('2', 'mgr-a')], [row('r1', 'mgr-a', '1')])
    expect(byTeam(r)['1']).toMatchObject({ rosterId: 'r1', ownerKey: 'mgr-a', rekey: false })
    expect(byTeam(r)['2']).toMatchObject({ rosterId: null, ownerKey: 'import:sleeper:2', keyConflict: true })
  })
})

describe('rows written before rows carried a team id', () => {
  it('are still matched by owner', () => {
    const r = plan([team('1', 'mgr-a', ['sleeper-1'])], [row('old', 'sleeper-1', null)])
    expect(byTeam(r)['1']).toMatchObject({ rosterId: 'old', ownerKey: 'mgr-a', rekey: true })
  })

  it('never on an empty key, even for a row with no team id', () => {
    const r = plan([team('10', 'orphan-sleeper-10', [''])], [row('legacy', '', null)])
    expect(byTeam(r)['10']).toMatchObject({ rosterId: null, ownerKey: 'orphan-sleeper-10' })
  })

  it('but a row bound to another team is never taken by owner', () => {
    const r = plan([team('1', 'mgr-a')], [row('other', 'mgr-a', '7')])
    expect(byTeam(r)['1']).toMatchObject({ rosterId: null, ownerKey: 'import:sleeper:1', keyConflict: true })
  })
})
