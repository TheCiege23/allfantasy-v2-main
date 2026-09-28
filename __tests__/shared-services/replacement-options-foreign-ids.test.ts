/**
 * @vitest-environment node
 *
 * 🛑 A foreign league's roster ids must never be read against the Sleeper-keyed projection table.
 *
 * A Fleaflicker / MFL / Fantrax / Yahoo roster holds that provider's own ids — short numbers that
 * collide with real Sleeper ids (51 of 248 on the one production Fleaflicker league). `FantasyProjection`
 * is keyed on Sleeper ids, so a bench id carried a stranger's projection under the right name, the
 * affected player was priced as somebody else, and the league's real players were never subtracted
 * from the "unrostered" pool — the chips offered pickups who are already rostered. Such a league now
 * gets honest empty lists and a reason. The control shows the same ids ARE priced in a Sleeper league.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = { platform: 'fleaflicker' }

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: vi.fn(async () => ({ id: 'L1', sport: 'NFL', season: 2026, platform: state.platform, platformLeagueId: 'P1' })),
    },
    roster: {
      findMany: vi.fn(async () => [
        {
          platformUserId: 'owner-1',
          playerData: {
            lineup_sections: {
              starters: [{ id: '6038', name: 'Their Own Starter', position: 'WR' }],
              bench: [{ id: '6100', name: 'Their Own Bench', position: 'WR' }],
            },
          },
        },
      ]),
    },
    fantasyProjection: {
      findFirst: vi.fn(async () => ({ week: 4 })),
      findMany: vi.fn(async ({ where }: { where: { playerId: { in?: string[]; notIn?: string[] } } }) => {
        if (where.playerId.in) {
          /* The Sleeper-keyed table: '6038' and '6100' ARE real Sleeper ids, and they are strangers. */
          const table: Record<string, number> = { '6038': 30, '6100': 20 }
          return where.playerId.in.filter((id) => table[id] != null).map((id) => ({ playerId: id, projectedPoints: table[id]! }))
        }
        return [{ playerId: '7000', projectedPoints: 25 }].filter((p) => !where.playerId.notIn?.includes(p.playerId))
      }),
    },
    sportsPlayer: {
      findMany: vi.fn(async () => [{ sleeperId: '7000', externalId: 'sleeper:7000', name: 'Pickup Guy', position: 'WR', team: 'KC' }]),
    },
  },
}))
vi.mock('@/lib/shared-services/game-day/UserPlayerExposureService', () => ({
  resolveLinkedPlatformUserIds: vi.fn(async () => ['owner-1']),
}))

import { resolveReplacementOptions } from '@/lib/shared-services/league-hub/replacementOptions'

const ARGS = { appUserId: 'u1', leagueId: 'L1', affectedPlayerId: '6038' }

beforeEach(() => {
  state.platform = 'fleaflicker'
})

describe('resolveReplacementOptions — a foreign league’s roster ids', () => {
  it('🛑 a Fleaflicker roster prices nobody and offers nobody, and says why', async () => {
    const r = await resolveReplacementOptions(ARGS)
    expect(r?.affectedProjection).toBeNull()
    expect(r?.benchOptions).toEqual([])
    expect(r?.freeAgentOptions.map((c) => c.name)).not.toContain('Pickup Guy')
    expect(r?.limitation).toBe('roster_ids_unreadable')
  })

  it('🛑 the same for MFL, Fantrax and Yahoo', async () => {
    for (const platform of ['mfl', 'fantrax', 'yahoo']) {
      state.platform = platform
      const r = await resolveReplacementOptions(ARGS)
      expect(r?.affectedProjection).toBeNull()
      expect(r?.benchOptions).toEqual([])
    }
  })

  it('CONTROL: in a Sleeper league the same ids ARE priced and a pickup is offered', async () => {
    state.platform = 'sleeper'
    const r = await resolveReplacementOptions(ARGS)
    expect(r?.affectedProjection).toBe(30)
    expect(r?.benchOptions.map((c) => c.playerId)).toEqual(['6100'])
    expect(r?.freeAgentOptions.map((c) => c.name)).toEqual(['Pickup Guy'])
    expect(r?.limitation).toBeNull()
  })
})
