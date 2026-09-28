/**
 * Settings saves reach the draft only before it starts, only for what changed, and only as ROSTER ids.
 *
 * Each case was measured on 3c83857ea:
 *   - the League Settings tab and randomize route store `LeagueTeam.id` as each slot's owner, the
 *     sync copied it into `DraftSession.slotOrder`, and the pick authority checks `Roster.id` —
 *     nobody was ever on the clock and every manager's pick was refused;
 *   - every settings save re-pushed rounds, type, 3RR and order, at any draft status, so a
 *     timezone edit rewrote a live or completed draft.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  session: null as null | { id: string; status: string; slotOrder: unknown },
  update: vi.fn(),
  rosters: [] as Array<{ id: string; platformUserId: string }>,
  teams: [] as Array<{ id: string; externalId: string; claimedByUserId: string | null; platformUserId: string | null }>,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftSession: {
      findFirst: vi.fn(async () => db.session),
      update: db.update,
    },
    roster: { findMany: vi.fn(async () => db.rosters) },
    leagueTeam: { findMany: vi.fn(async () => db.teams) },
  },
}))

import {
  buildRosterIdResolver,
  draftOrderSlotsToSlotOrder,
  syncDraftSessionFromLeagueSettings,
} from '@/lib/league/league-settings-draft-sync'

const leagueSettings = (overrides: Record<string, unknown> = {}) =>
  ({
    pickTimerPreset: '90s',
    pickTimerCustomValue: null,
    draftType: 'snake',
    rounds: 15,
    aiAutoPick: false,
    cpuAutoPick: true,
    playerPool: 'all',
    alphabeticalSort: false,
    // The Settings tab stores TEAM ids.
    draftOrderSlots: [
      { slot: 1, ownerId: 'team-b', ownerName: 'Ben' },
      { slot: 2, ownerId: 'team-a', ownerName: 'Amy' },
    ],
    ...overrides,
  }) as never

beforeEach(() => {
  vi.clearAllMocks()
  db.session = { id: 'ds-1', status: 'pre_draft', slotOrder: [] }
  db.rosters = [
    { id: 'roster-a', platformUserId: 'amy' },
    { id: 'roster-b', platformUserId: 'ben' },
  ]
  db.teams = [
    { id: 'team-a', externalId: 'roster-a', claimedByUserId: 'amy', platformUserId: 'amy' },
    { id: 'team-b', externalId: 'roster-b', claimedByUserId: 'ben', platformUserId: 'ben' },
  ]
})

describe('slot owners become roster ids', () => {
  it('translates stored team ids to the roster the draft engine authorises', async () => {
    const result = await syncDraftSessionFromLeagueSettings('L', leagueSettings(), 2, new Set(['draftOrderSlots']))
    expect(result).toEqual({ synced: true })
    const data = db.update.mock.calls[0][0].data
    expect(data.slotOrder).toEqual([
      { slot: 1, rosterId: 'roster-b', displayName: 'Ben' },
      { slot: 2, rosterId: 'roster-a', displayName: 'Amy' },
    ])
  })

  it('finds an imported team’s roster through the person who holds it', () => {
    const resolve = buildRosterIdResolver(
      [{ id: 'roster-x', platformUserId: 'amy' }],
      [{ id: 'team-x', externalId: 'sleeper-7', claimedByUserId: 'amy', platformUserId: 'sleeper-user' }],
    )
    expect(resolve('team-x')).toBe('roster-x')
    expect(resolve('roster-x')).toBe('roster-x')
    expect(resolve('nobody')).toBeNull()
  })

  it('does not apply an order it cannot place completely', async () => {
    const ls = leagueSettings({
      draftOrderSlots: [
        { slot: 1, ownerId: 'team-a', ownerName: 'Amy' },
        { slot: 2, ownerId: 'team-gone', ownerName: '?' },
      ],
    })
    const result = await syncDraftSessionFromLeagueSettings('L', ls, 2, new Set(['draftOrderSlots']))
    expect(result).toEqual({ synced: false, reason: 'nothing_to_sync' })
    expect(db.update).not.toHaveBeenCalled()
  })

  it('keeps the old identity mapping for callers that pass no resolver', () => {
    expect(draftOrderSlotsToSlotOrder([{ slot: 1, ownerId: 'r1', ownerName: 'A' }], 1)).toEqual([
      { slot: 1, rosterId: 'r1', displayName: 'A' },
    ])
  })
})

describe('only before the draft starts, only what changed', () => {
  it.each(['in_progress', 'paused', 'completed'])('leaves a %s draft alone', async (status) => {
    db.session = { id: 'ds-1', status, slotOrder: [] }
    const result = await syncDraftSessionFromLeagueSettings('L', leagueSettings({ rounds: 3 }), 2, new Set(['rounds']))
    expect(result).toEqual({ synced: false, reason: 'draft_started' })
    expect(db.update).not.toHaveBeenCalled()
  })

  it('a timezone save does not touch the draft at all', async () => {
    const result = await syncDraftSessionFromLeagueSettings('L', leagueSettings(), 2, new Set(['timezone']))
    expect(result).toEqual({ synced: false, reason: 'nothing_to_sync' })
    expect(db.update).not.toHaveBeenCalled()
  })

  it('a rounds save writes rounds and nothing else', async () => {
    await syncDraftSessionFromLeagueSettings('L', leagueSettings({ rounds: 16 }), 2, new Set(['rounds']))
    const data = db.update.mock.calls[0][0].data
    expect(Object.keys(data).sort()).toEqual(['rounds', 'version'])
    expect(data.rounds).toBe(16)
  })
})
