// @vitest-environment node
/**
 * 🛑 The NFL data foundation's injury read — what `/api/redraft/roster`'s weekly and rest-of-season
 * projections and `/api/trade-evaluator`'s `injuryRisk` are built on — used to:
 *   - match `SportsInjury.playerId IN <candidate ids incl. the Sleeper id>` — a provider's own id, so
 *     Sleeper 8394 (Percy Butler) got Rolling Insights 8394's (Rome Odunze's) Out;
 *   - read expired and stale rows, newest FETCH first;
 *   - fall back to `SportsPlayer.status` — RI "ACT" — which the projection engine read as injury risk;
 *   - call a suspension "low" risk.
 *
 * The fake database honours each query's `where`, as Postgres does, so the old id-OR read and the new
 * live-rows read are both judged by what they actually ask.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { getCanonicalNflTradeContext } from '@/lib/nfl-data-foundation/nflDataFoundationService'

const NOW = Date.now()
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000)
const inDays = (d: number) => new Date(NOW + d * 24 * 3_600_000)

type Row = Record<string, unknown>

function sp(id: string, name: string, position: string, team: string, source: string, status: string | null, sleeperId: string | null = null): Row {
  return {
    id,
    sport: 'NFL',
    externalId: source === 'sleeper' ? `sleeper:${sleeperId}` : `ri-${id}`,
    name,
    position,
    team,
    teamId: null,
    number: null,
    imageUrl: null,
    sleeperId,
    status,
    source,
    fetchedAt: hoursAgo(1),
    expiresAt: inDays(1),
    updatedAt: hoursAgo(1),
  }
}

function injury(over: Row): Row {
  return {
    sport: 'NFL',
    playerId: null,
    playerName: 'Nobody',
    team: null,
    position: null,
    status: 'Out',
    date: hoursAgo(20),
    fetchedAt: hoursAgo(1),
    expiresAt: inDays(2),
    season: null,
    week: null,
    ...over,
  }
}

function fakeDb(players: Row[], injuries: Row[]) {
  const empty = new Proxy(
    {},
    { get: (_t, method: string) => async () => (String(method).startsWith('findMany') ? [] : String(method) === 'count' ? 0 : null) },
  )
  const real: Record<string, unknown> = {
    sportsPlayer: {
      findMany: async ({ where }: { where: unknown }) => {
        const w = JSON.stringify(where)
        return players.filter((p) => w.includes(`"${p.id}"`))
      },
      findFirst: async () => null,
    },
    sportsInjury: {
      // The old per-player read: `playerId IN ids OR playerName = name`, newest fetch first.
      findFirst: async ({ where }: { where: { OR: Array<{ playerId?: { in: string[] }; playerName?: string }> } }) => {
        const hits = injuries.filter((r) =>
          where.OR.some((c) => (c.playerId ? c.playerId.in.includes(String(r.playerId)) : c.playerName === r.playerName)),
        )
        return hits.sort((a, b) => (b.fetchedAt as Date).getTime() - (a.fetchedAt as Date).getTime())[0] ?? null
      },
      // The new one: the live feed for the sport.
      findMany: async ({ where }: { where: { sport: string; expiresAt?: { gt: Date } } }) =>
        injuries.filter(
          (r) => r.sport === where.sport && (!where.expiresAt || (r.expiresAt as Date).getTime() > where.expiresAt.gt.getTime()),
        ),
    },
    fantasyProjection: { findFirst: async () => ({ projectedPoints: 15, fetchedAt: hoursAgo(2) }) },
  }
  return new Proxy(real, { get: (t, key: string) => (key in t ? t[key] : empty) }) as never
}

async function trade(players: Row[], injuries: Row[], assetIds: string[]) {
  const ctx = await getCanonicalNflTradeContext(
    assetIds.map((playerId) => ({ assetType: 'player' as const, playerId })),
    { season: 2026, week: 6, prismaClient: fakeDb(players, injuries) },
  )
  return Object.fromEntries(ctx.assets.map((a) => [a.canonicalPlayer?.playerName ?? a.playerId, a]))
}

describe('NFL data foundation — injury status from the live feed, by verified name', () => {
  it('🛑 Percy Butler never inherits Rome Odunze’s Out through a shared provider id (8394)', async () => {
    const got = await trade(
      [sp('sp-butler', 'Percy Butler', 'S', 'WAS', 'sleeper', 'Active', '8394')],
      [injury({ playerId: '8394', playerName: 'Rome Odunze', team: 'Chicago Bears', position: 'WR', status: 'Out' })],
      ['sp-butler'],
    )
    const butler = got['Percy Butler']
    expect(butler.canonicalPlayer?.injuryStatus).toBeNull()
    expect(butler.canonicalPlayer?.projection?.reasonCodes).not.toContain('injury_status_adjustment')
    expect(butler.injuryRisk).toBe('low')
  })

  it('🛑 a Rolling Insights roster word ("ACT") is not an injury — no risk discount on the projection', async () => {
    const got = await trade([sp('sp-steady', 'Steady Starter', 'WR', 'DAL', 'rolling_insights', 'ACT')], [], ['sp-steady'])
    const steady = got['Steady Starter']
    expect(steady.canonicalPlayer?.injuryStatus).toBeNull()
    expect(steady.canonicalPlayer?.projection?.reasonCodes).not.toContain('injury_status_adjustment')
  })

  it('🛑 last week’s Out and an EXPIRED Out do not zero this week', async () => {
    const got = await trade(
      [
        sp('sp-stale', 'Last Week Out', 'RB', 'NYG', 'sleeper', 'Active', '5001'),
        sp('sp-expired', 'Expired Out', 'RB', 'NYG', 'sleeper', 'Active', '5002'),
      ],
      [
        injury({ playerName: 'Last Week Out', team: 'New York Giants', position: 'RB', date: hoursAgo(10 * 24) }),
        injury({ playerName: 'Expired Out', team: 'New York Giants', position: 'RB', expiresAt: hoursAgo(1) }),
      ],
      ['sp-stale', 'sp-expired'],
    )
    for (const name of ['Last Week Out', 'Expired Out']) {
      expect(got[name].canonicalPlayer?.injuryStatus, name).toBeNull()
      expect(got[name].canonicalPlayer?.projection?.unavailable, name).toBe(false)
    }
  })

  it('the newest CLAIM wins: Sunday’s "Active" clears Friday’s re-pulled "Questionable"', async () => {
    const got = await trade(
      [sp('sp-cleared', 'Cleared Receiver', 'WR', 'CIN', 'sleeper', 'Active', '5003')],
      [
        injury({ playerName: 'Cleared Receiver', team: 'Cincinnati Bengals', position: 'WR', status: 'Questionable', date: hoursAgo(50), fetchedAt: hoursAgo(0.1) }),
        injury({ playerName: 'Cleared Receiver', team: 'Cincinnati Bengals', position: 'WR', status: 'Active', date: hoursAgo(3), fetchedAt: hoursAgo(3) }),
      ],
      ['sp-cleared'],
    )
    expect(got['Cleared Receiver'].canonicalPlayer?.injuryStatus).toBeNull()
  })

  it('a current Out zeroes this week, and a suspension is HIGH risk — not low', async () => {
    const got = await trade(
      [
        sp('sp-out', 'Hurt Today', 'QB', 'DET', 'sleeper', 'Active', '5004'),
        sp('sp-susp', 'Suspended Guy', 'WR', 'DET', 'sleeper', 'Active', '5005'),
      ],
      [
        injury({ playerName: 'Hurt Today', team: 'Detroit Lions', position: 'QB', status: 'Out' }),
        injury({ playerName: 'Suspended Guy', team: 'Detroit Lions', position: 'WR', status: 'Suspension' }),
      ],
      ['sp-out', 'sp-susp'],
    )
    expect(got['Hurt Today'].canonicalPlayer?.injuryStatus).toBe('Out')
    expect(got['Hurt Today'].canonicalPlayer?.projection?.projectedPoints).toBe(0)
    expect(got['Suspended Guy'].injuryRisk).toBe('high')
  })
})
