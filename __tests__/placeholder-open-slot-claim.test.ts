import { describe, expect, it, vi } from 'vitest'
import { claimPlaceholderRoster } from '@/lib/league-import/placeholderClaim'

describe('claimPlaceholderRoster native open slots', () => {
  it('claims the first transaction-created open team shell for a joining manager', async () => {
    const tx = {
      roster: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'roster-1',
            platformUserId: 'app-user-1',
            playerData: { draftPicks: [], foundation: { slotNumber: 1, openTeam: false } },
          },
          {
            id: 'roster-2',
            platformUserId: 'open-slot-league-1-2',
            playerData: {
              draftPicks: [],
              foundation: { slotNumber: 2, openTeam: true, label: 'Open Team 2' },
            },
          },
        ]),
        update: vi.fn().mockResolvedValue({ id: 'roster-2' }),
      },
      appUser: {
        findMany: vi.fn().mockResolvedValue([{ id: 'app-user-1' }]),
      },
      leagueTeam: {
        findMany: vi.fn().mockResolvedValue([
          { externalId: 'roster-2', ownerName: 'Open Team 2', teamName: 'Open Team 2' },
        ]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      leagueEntrySlot: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      redraftLeagueMember: {
        create: vi.fn().mockResolvedValue({ id: 'member-2' }),
      },
    }

    const result = await claimPlaceholderRoster({
      tx: tx as any,
      leagueId: 'league-1',
      candidate: {
        appUserId: 'app-user-2',
        displayName: 'Second Manager',
        sleeperUsername: null,
        email: 'second@test.local',
      },
    })

    expect(result).toEqual({ claimed: true, rosterId: 'roster-2', matchedBy: 'native_open_slot' })
    expect(tx.roster.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'roster-2' },
        data: expect.objectContaining({
          platformUserId: 'app-user-2',
          settings: expect.objectContaining({ openSlot: false }),
        }),
      }),
    )
    expect(tx.leagueTeam.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { leagueId: 'league-1', externalId: 'roster-2' },
        data: expect.objectContaining({
          ownerName: 'Second Manager',
          claimedByUserId: 'app-user-2',
          /*
           * The legacy flag is still written so no unmigrated reader changes meaning, but it is
           * no longer the thing that MEANS anything — `isOrphan: false` was the only way this
           * writer could say "somebody is in this seat now", and it could not also say the
           * franchise is current. The two axes below are what it says instead.
           */
          isOrphan: false,
          lifecycleState: 'CURRENT',
          managerKind: 'HUMAN',
        }),
      }),
    )
    expect(tx.leagueEntrySlot.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { leagueId: 'league-1', rosterId: 'roster-2' },
        data: { status: 'FILLED' },
      }),
    )
    expect(tx.redraftLeagueMember.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          leagueId: 'league-1',
          userId: 'app-user-2',
          role: 'MEMBER',
          teamNumber: 2,
        }),
      }),
    )
  })
})
