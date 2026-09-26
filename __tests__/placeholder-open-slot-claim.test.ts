import { describe, expect, it, vi } from 'vitest'
import { claimPlaceholderRoster } from '@/lib/league-import/placeholderClaim'

/**
 * A code join into a native league takes the first open team shell. The claim now goes through
 * `assignLeagueSeat` (lib/league/leagueSeats.ts), so the mock serves the calls that writer makes;
 * the assertions are the same records the inline version wrote — and the membership row is now an
 * UPSERT, because the join route writes it too and a duplicate insert aborts a Postgres
 * transaction (the `.create().catch()` that was here hid the error, not the abort).
 */
describe('claimPlaceholderRoster native open slots', () => {
  it('claims the first transaction-created open team shell for a joining manager', async () => {
    const openRoster = {
      id: 'roster-2',
      platformUserId: 'open-slot-league-1-2',
      playerData: {
        draftPicks: [],
        foundation: { slotNumber: 2, openTeam: true, label: 'Open Team 2' },
      },
      settings: { openSlot: true, aiManaged: false },
    }
    const tx = {
      league: {
        findUnique: vi.fn().mockResolvedValue({ platform: 'manual', userId: 'app-user-1' }),
      },
      roster: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'roster-1',
            platformUserId: 'app-user-1',
            playerData: { draftPicks: [], foundation: { slotNumber: 1, openTeam: false } },
          },
          openRoster,
        ]),
        findFirst: vi.fn(async ({ where }: { where: { id?: string } }) => (where.id === 'roster-2' ? openRoster : null)),
        update: vi.fn().mockResolvedValue({ id: 'roster-2' }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      appUser: {
        findMany: vi.fn().mockResolvedValue([{ id: 'app-user-1' }]),
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
          where.id === 'app-user-2'
            ? { id: 'app-user-2', username: 'second', displayName: null, email: 'second@test.local' }
            : null,
        ),
      },
      userProfile: { findFirst: vi.fn().mockResolvedValue(null) },
      leagueTeam: {
        findMany: vi.fn().mockResolvedValue([
          { externalId: 'roster-2', ownerName: 'Open Team 2', teamName: 'Open Team 2' },
        ]),
        findFirst: vi.fn().mockResolvedValue({
          id: 'team-2',
          platformUserId: 'open-slot-league-1-2',
          claimedByUserId: null,
          teamName: 'Open Team 2',
        }),
        update: vi.fn().mockResolvedValue({ id: 'team-2' }),
      },
      leagueEntrySlot: {
        findFirst: vi.fn().mockResolvedValue({ id: 'slot-2', slotNumber: 2, status: 'OPEN' }),
        update: vi.fn().mockResolvedValue({ id: 'slot-2' }),
      },
      redraftLeagueMember: {
        upsert: vi.fn().mockResolvedValue({ id: 'member-2' }),
      },
      redraftRoster: {
        findMany: vi.fn().mockResolvedValue([]),
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
    expect(tx.roster.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'roster-2', leagueId: 'league-1', platformUserId: 'open-slot-league-1-2' },
        data: expect.objectContaining({
          platformUserId: 'app-user-2',
          settings: expect.objectContaining({ openSlot: false }),
        }),
      }),
    )
    expect(tx.leagueTeam.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'team-2' },
        data: expect.objectContaining({
          ownerName: 'Second Manager',
          claimedByUserId: 'app-user-2',
          isOrphan: false,
        }),
      }),
    )
    expect(tx.leagueEntrySlot.update).toHaveBeenCalledWith({ where: { id: 'slot-2' }, data: { status: 'FILLED' } })
    expect(tx.redraftLeagueMember.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { leagueId_userId: { leagueId: 'league-1', userId: 'app-user-2' } },
        create: expect.objectContaining({
          leagueId: 'league-1',
          userId: 'app-user-2',
          role: 'MEMBER',
          teamNumber: 2,
        }),
      }),
    )
  })
})
