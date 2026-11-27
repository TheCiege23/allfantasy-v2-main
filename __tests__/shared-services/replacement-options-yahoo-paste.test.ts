/**
 * @vitest-environment node
 *
 * 🛑 A pasted Yahoo league: "not on any roster" is not "available" until its coverage says so.
 *
 * The paste import stores each resolved player DECLARED (`sleeper:<id>`) and every other one as
 * `yahoo-paste:<name>|<pos>|<team>` (lib/core-app/declaredAvailability.ts). Above the 80% coverage bar
 * the chips are priced on the declared ids, the unmatched player's own row is kept off the free agents
 * and the count travels; below the bar there is no list, only `availability_unverified` with the count.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = { rosters: [] as Array<{ platformUserId: string; playerData: unknown }> }

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: vi.fn(async () => ({ id: 'Y1', sport: 'NFL', season: 2026, platform: 'yahoo', platformLeagueId: 'P1' })),
    },
    roster: { findMany: vi.fn(async () => state.rosters) },
    fantasyProjection: {
      findFirst: vi.fn(async () => ({ week: 4 })),
      findMany: vi.fn(async ({ where }: { where: { playerId: { in?: string[]; notIn?: string[] } } }) => {
        const table: Record<string, number> = { '6038': 10, '7000': 25, '7001': 28, '7002': 40 }
        if (where.playerId.in) return where.playerId.in.filter((id) => table[id] != null).map((id) => ({ playerId: id, projectedPoints: table[id]! }))
        return Object.entries(table)
          .filter(([id]) => !where.playerId.notIn?.includes(id))
          .map(([playerId, projectedPoints]) => ({ playerId, projectedPoints }))
      }),
    },
    sportsPlayer: {
      findMany: vi.fn(async () => [
        { sleeperId: '7000', externalId: 'sleeper:7000', name: 'Pickup Guy', position: 'WR', team: 'KC' },
        { sleeperId: '7001', externalId: 'sleeper:7001', name: 'Pasted Guy', position: 'WR', team: 'NYJ' },
        { sleeperId: '7002', externalId: 'sleeper:7002', name: 'Rostered Star', position: 'WR', team: 'DAL' },
      ]),
    },
  },
}))
vi.mock('@/lib/shared-services/game-day/UserPlayerExposureService', () => ({
  resolveLinkedPlatformUserIds: vi.fn(async () => ['owner-1']),
}))

import { resolveReplacementOptions } from '@/lib/shared-services/league-hub/replacementOptions'

const ARGS = { appUserId: 'u1', leagueId: 'Y1', affectedPlayerId: '6038' }
const declared = (n: number) => Array.from({ length: n }, (_, i) => `sleeper:${100 + i}`)

beforeEach(() => {
  state.rosters = [
    { platformUserId: 'owner-1', playerData: { players: ['sleeper:6038', ...declared(7)], starters: ['sleeper:6038'] } },
    // The rival: a declared star and one pasted player nobody could match. 9 of 10 ids declared.
    { platformUserId: 'owner-2', playerData: { players: ['sleeper:7002', 'yahoo-paste:pasted guy|WR|NYJ'] } },
  ]
})

describe('resolveReplacementOptions — a pasted Yahoo league', () => {
  it('above the bar: prices the affected player, offers the real free agent, and counts the unmatched one', async () => {
    const r = await resolveReplacementOptions(ARGS)
    expect(r?.limitation).toBeNull()
    expect(r?.affectedProjection).toBe(10)
    expect(r?.freeAgentOptions.map((c) => c.name)).toEqual(['Pickup Guy'])
    expect(r?.unmatchedRostered).toBe(1)
  })

  it('🛑 never offers the unmatched pasted player, nor a declared rostered one, as a free agent', async () => {
    const names = (await resolveReplacementOptions(ARGS))?.freeAgentOptions.map((c) => c.name) ?? []
    expect(names).not.toContain('Pasted Guy')
    expect(names).not.toContain('Rostered Star')
  })

  it('below the bar: no lists, an explicit availability_unverified with the count', async () => {
    state.rosters = [
      { platformUserId: 'owner-1', playerData: { players: ['sleeper:6038'] } },
      { platformUserId: 'owner-2', playerData: { players: ['yahoo-paste:pasted guy|WR|NYJ', 'yahoo-paste:x|RB|KC'] } },
    ]
    const r = await resolveReplacementOptions(ARGS)
    expect(r?.limitation).toBe('availability_unverified')
    expect(r?.unmatchedRostered).toBe(2)
    expect(r?.freeAgentOptions).toEqual([])
    expect(r?.benchOptions).toEqual([])
  })
})
