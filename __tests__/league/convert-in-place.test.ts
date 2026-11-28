import { describe, expect, it } from 'vitest'
import {
  assignNativeSeats,
  orderTeamsForSeats,
  remapSlotOrder,
  remapTeamRecords,
} from '@/lib/league/convertImportedLeagueInPlace'
import type { ImportedRoster, ImportedTeam } from '@/lib/league-creation/canonical/importedIdentityPlan'

const team = (n: number, claimedByUserId: string | null, isCommissioner = false): ImportedTeam => ({
  id: `team-${n}`, externalId: String(n), platformUserId: `p${n}`, claimedByUserId,
  teamName: `Team ${n}`, ownerName: `owner${n}`, avatarUrl: null, isCommissioner,
})
const roster = (n: number): ImportedRoster => ({ id: `roster-${n}`, platformUserId: `p${n}`, playerData: {}, faabRemaining: null, waiverPriority: null })

describe('assignNativeSeats', () => {
  it('keys a claimed seat by its user, an open seat by open-slot, and a second team by its roster', () => {
    const seats = assignNativeSeats('L', [team(1, 'u1'), team(2, null), team(3, 'u1')], [roster(1), roster(2), roster(3)])
    expect(seats.map((s) => [s.slotNumber, s.ownerKey, s.managerUserId])).toEqual([
      [1, 'u1', null],
      [2, 'open-slot-L-2', null],
      [3, 'roster:roster-3', 'u1'],
    ])
    expect(seats.map((s) => s.rosterId)).toEqual(['roster-1', 'roster-2', 'roster-3'])
  })
})

describe('orderTeamsForSeats', () => {
  it("seats the commissioner's own team first, then provider order", () => {
    const ordered = orderTeamsForSeats([team(3, null), team(2, 'me'), team(1, null, true)], 'me')
    expect(ordered.map((t) => t.externalId)).toEqual(['2', '1', '3'])
  })
  it('falls back to the provider commissioner team when the converting user holds none', () => {
    expect(orderTeamsForSeats([team(2, null), team(1, null, true)], 'admin').map((t) => t.externalId)).toEqual(['1', '2'])
  })
})

describe('remapSlotOrder / remapTeamRecords', () => {
  const rosters = new Map([['1', 'roster-1'], ['2', 'roster-2']])
  it('moves draft slots from provider ids to roster ids and leaves unknown entries alone', () => {
    expect(remapSlotOrder([{ slot: 1, rosterId: '1' }, { slot: 2, rosterId: 'x' }, 'junk'], rosters))
      .toEqual([{ slot: 1, rosterId: 'roster-1' }, { slot: 2, rosterId: 'x' }, 'junk'])
    expect(remapSlotOrder(null, rosters)).toBeNull()
  })
  it('maps team keys to team ids and roster keys to roster ids, keeping the source roster id', () => {
    const teams = new Map([['1', 'team-1']])
    expect(remapTeamRecords([{ teamId: '1', rosterId: '2', wins: 9 }], teams, rosters))
      .toEqual([{ teamId: 'team-1', rosterId: 'roster-2', sourceRosterId: '2', wins: 9 }])
  })
})
