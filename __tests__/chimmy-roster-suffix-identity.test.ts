import { describe, expect, it } from 'vitest'
import { findRosteredByName } from '@/lib/chimmy/leagueRosterIndex'
const jr = { playerId: 'jr', rosterId: 'r1', name: 'Tyrone Tracy Jr.', position: 'RB' }
const sr = { playerId: 'sr', rosterId: 'r2', name: 'Tyrone Tracy Sr.', position: 'RB' }
describe('omitted screenshot name suffix', () => {
  it('bridges an omitted suffix to the only rostered identity', () => {
    const index = new Map([['tyrone tracy jr', [jr]]])
    expect(findRosteredByName(index, 'Tyrone Tracy').hits).toEqual([jr])
  })
  it('does not collapse two distinct identities', () => {
    const index = new Map([['tyrone tracy jr', [jr]], ['tyrone tracy sr', [sr]]])
    expect(findRosteredByName(index, 'Tyrone Tracy').hits).toEqual([])
  })
  it('does not change a specifically requested suffix', () => {
    const index = new Map([['tyrone tracy jr', [jr]]])
    expect(findRosteredByName(index, 'Tyrone Tracy Sr.').hits).toEqual([])
  })
  it('keeps strict identities ahead of the suffix bridge', () => {
    const index = new Map([['tyrone tracy', [sr]], ['tyrone tracy jr', [jr]]])
    expect(findRosteredByName(index, 'Tyrone Tracy').hits).toEqual([sr])
  })
})
