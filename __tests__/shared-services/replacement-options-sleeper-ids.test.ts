/**
 * @vitest-environment node
 *
 * 🛑 An unrostered pickup is named — and position-filtered — from HIS row, never from a Rolling
 * Insights row that shares the number. Projection ids are Sleeper ids; RI writes its own numbers into
 * `SportsPlayer.externalId`. A real pair from production (2026-09-29): Sleeper 843 is Cameron Heyward
 * (DL); RI 843 is Charles Johnson (WR). The old identity read matched both and let the RI row win, so
 * for a WR replacement it offered "Charles Johnson" — carrying Heyward's projection, and passing the
 * same-position filter on the impostor's position. The mock database honours the query's `where`.
 */
import { describe, expect, it, vi } from 'vitest'

type Row = { sleeperId: string | null; externalId: string; source: string; name: string; position: string; team: string }
const PLAYERS: Row[] = [
  { sleeperId: '843', externalId: 'sleeper:843', source: 'sleeper', name: 'Cameron Heyward', position: 'DL', team: 'PIT' },
  { sleeperId: null, externalId: '843', source: 'rolling_insights', name: 'Charles Johnson', position: 'WR', team: 'MIN' },
  { sleeperId: '7000', externalId: 'sleeper:7000', source: 'sleeper', name: 'Pickup Guy', position: 'WR', team: 'KC' },
]
type Clause = { sleeperId?: { in: string[] }; externalId?: { in: string[] } }

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: vi.fn(async () => ({ id: 'L1', sport: 'NFL', season: 2026, platform: 'sleeper', platformLeagueId: 'P1' })),
    },
    roster: {
      findMany: vi.fn(async () => [
        {
          platformUserId: 'owner-1',
          playerData: {
            lineup_sections: {
              starters: [{ id: '6038', name: 'Hurt Receiver', position: 'WR' }],
              bench: [],
            },
          },
        },
      ]),
    },
    fantasyProjection: {
      findFirst: vi.fn(async () => ({ week: 4 })),
      findMany: vi.fn(async ({ where }: { where: { playerId: { in?: string[]; notIn?: string[] } } }) => {
        if (where.playerId.in) return where.playerId.in.includes('6038') ? [{ playerId: '6038', projectedPoints: 8 }] : []
        return [
          { playerId: '843', projectedPoints: 25 },
          { playerId: '7000', projectedPoints: 12 },
        ].filter((p) => !where.playerId.notIn?.includes(p.playerId))
      }),
    },
    sportsPlayer: {
      findMany: vi.fn(async ({ where }: { where: { OR: Clause[] } }) =>
        PLAYERS.filter((p) =>
          where.OR.some(
            (c) =>
              (p.sleeperId != null && (c.sleeperId?.in.includes(p.sleeperId) ?? false)) ||
              (c.externalId?.in.includes(p.externalId) ?? false),
          ),
        ),
      ),
    },
  },
}))
vi.mock('@/lib/shared-services/game-day/UserPlayerExposureService', () => ({
  resolveLinkedPlatformUserIds: vi.fn(async () => ['owner-1']),
}))

import { resolveReplacementOptions } from '@/lib/shared-services/league-hub/replacementOptions'

describe('resolveReplacementOptions — a pickup whose Sleeper id an RI row also carries', () => {
  it('never offers the RI impostor; Sleeper 843 is a DL and is filtered out of a WR replacement', async () => {
    const r = await resolveReplacementOptions({ appUserId: 'u1', leagueId: 'L1', affectedPlayerId: '6038' })
    expect(r?.freeAgentOptions.map((c) => c.name)).toEqual(['Pickup Guy'])
  })
})
