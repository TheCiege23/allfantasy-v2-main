// @vitest-environment node
/**
 * 🛑 A tanking flag names the player a manager STARTED — the most damning line a commissioner reads.
 *
 * The name resolver matched lineup ids against `SportsPlayer.externalId` as well as `sleeperId`, and
 * `externalId` is where Rolling Insights keeps its OWN numbers for different people: Sleeper 9228 is
 * Bryce Young, RI 9228 is Michael Tarquin, an offensive tackle. So the accusation could name a player
 * who was never in the lineup. A foreign league's ids collide with Sleeper's too, so they are not
 * looked up at all — a bare id is better than a stranger's name on an integrity card.
 * The mock database honours the query's `where`, as Postgres does.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Player = { id: string; sleeperId: string | null; externalId: string; source: string; name: string }
/*
 * Impostor FIRST. The old resolver kept the first row per key, and a read with no ORDER BY may return
 * rows in any order — so the bug is order-dependent, and a fixture listing the real row first would
 * pass on the broken code by luck. (Measured: it did, until this was reordered.)
 */
const PLAYERS: Player[] = [
  { id: 'u-mt', sleeperId: null, externalId: '9228', source: 'rolling_insights', name: 'Michael Tarquin' },
  { id: 'u-by', sleeperId: '9228', externalId: 'sleeper:9228', source: 'sleeper', name: 'Bryce Young' },
]
type Clause = { id?: { in: string[] }; sleeperId?: { in: string[] }; externalId?: { in: string[] } }

const h = vi.hoisted(() => ({ platform: 'manual' as string, playerReads: 0 }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/ai/aiSpendGuard', () => ({ isAiSpendEnabled: () => false }))
vi.mock('@/lib/integrity/integrityNotifier', () => ({ notifyCommissionerOfFlag: vi.fn(async () => {}) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueIntegritySettings: {
      findUnique: vi.fn(async () => ({ tankingMonitorEnabled: true, tankingStartWeek: null, tankingSensitivity: 'medium' })),
      upsert: vi.fn(async () => ({})),
    },
    redraftMatchup: {
      findMany: vi.fn(async () => [
        {
          homeRoster: { id: 'r1', teamName: 'Team One', ownerName: 'Pat', wins: 0, losses: 3, isEliminated: false },
          awayRoster: null,
          lineupSnapshots: [
            {
              rosterId: 'r1',
              starters: [{ playerId: '9228', injuryStatus: 'OUT', projection: 0 }],
              bench: [{ playerId: 'b1', projection: 14 }],
            },
          ],
        },
      ]),
    },
    league: { findFirst: vi.fn(async () => ({ playoffStartWeek: 15, sport: 'NFL', platform: h.platform })) },
    sportsPlayer: {
      findMany: vi.fn(async ({ where }: { where: { OR: Clause[] } }) => {
        h.playerReads++
        return PLAYERS.filter((p) =>
          where.OR.some(
            (c) =>
              (c.id?.in.includes(p.id) ?? false) ||
              (p.sleeperId != null && (c.sleeperId?.in.includes(p.sleeperId) ?? false)) ||
              (c.externalId?.in.includes(p.externalId) ?? false),
          ),
        )
      }),
    },
    integrityFlag: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: 'flag1' })),
    },
  },
}))

import { scanWeekForTanking } from '@/lib/integrity/TankingDetectionEngine'

const startedName = async () =>
  (await scanWeekForTanking('L1', 5)).flags[0]?.evidence.illegalOrSuspiciousStarters[0]?.startedPlayerName

beforeEach(() => {
  h.platform = 'manual'
  h.playerReads = 0
})

describe('tanking flag — the started player’s name', () => {
  it('names Sleeper 9228 as Bryce Young, never the Rolling Insights row that shares the number', async () => {
    expect(await startedName()).toBe('Bryce Young')
  })

  it('leaves a foreign league’s id unresolved rather than naming a stranger', async () => {
    h.platform = 'fleaflicker'
    expect(await startedName()).toBe('9228')
    expect(h.playerReads).toBe(0)
  })
})
