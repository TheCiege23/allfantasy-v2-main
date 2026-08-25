import { beforeEach, describe, expect, it, vi } from 'vitest'

const { activityFindMany, teamFindMany, playerFindMany } = vi.hoisted(() => ({
  activityFindMany: vi.fn(),
  teamFindMany: vi.fn(),
  playerFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    decisionOsImportedActivity: { findMany: activityFindMany },
    leagueTeam: { findMany: teamFindMany },
    sportsPlayer: { findMany: playerFindMany },
  },
}))

import { getLeagueActivity } from '@/lib/core-app/leagueActivity'

const ARGS = { leagueId: 'af-uuid', platformLeagueId: '99887766' }
const T = (iso: string) => new Date(iso)

beforeEach(() => {
  activityFindMany.mockReset()
  teamFindMany.mockResolvedValue([
    {
      externalId: '1', teamName: 'Yours', ownerName: 'chxnk', avatarUrl: 'https://cdn/a.png',
      platformUserId: 'sleeperU1', claimedByUserId: 'af-user-1',
    },
    {
      externalId: '2', teamName: 'Theirs', ownerName: 'Hustead', avatarUrl: null,
      platformUserId: 'sleeperU2', claimedByUserId: null,
    },
  ])
  playerFindMany.mockResolvedValue([
    { sleeperId: 'p1', name: 'Darren Waller', position: 'TE', team: 'CAR' },
    { sleeperId: 'p2', name: 'Tyjae Spears', position: 'RB', team: 'TEN', imageUrl: 'https://img/p2.png' },
  ])
})

describe('getLeagueActivity', () => {
  it('⚠ reads the transactions the page claimed were "not ingested"', async () => {
    /*
     * The panel said "league transactions are not ingested for this platform
     * yet" while thousands of completed Sleeper transactions sat in
     * decision_os_imported_activity. It was declining to look and blaming the
     * data.
     */
    activityFindMany.mockResolvedValue([
      {
        id: 'a1',
        activityType: 'waiver',
        occurredAt: T('2026-08-24T10:00:00Z'),
        rosterId: null,
        payload: { adds: ['p2'], drops: [] },
      },
    ])

    const out = await getLeagueActivity(ARGS)
    expect(out!.items).toHaveLength(1)
    expect(out!.counts.waiver).toBe(1)
    expect(out!.items[0].adds[0].label).toContain('Tyjae Spears')
  })

  it('⚠ queries BOTH id spaces, because rows have been written under each', async () => {
    // There was a period where afLeagueId came back NULL on every row, which
    // made the table unreachable through the obvious query.
    activityFindMany.mockResolvedValue([])
    await getLeagueActivity(ARGS)
    const where = activityFindMany.mock.calls[0][0].where
    const ors = JSON.stringify(where.OR)
    expect(ors).toContain('af-uuid')
    expect(ors).toContain('99887766')
  })

  it('⚠ dedupes a trade that the emitter wrote once PER ROSTER', async () => {
    /*
     * One transaction becomes one row for each roster involved, so a two-team
     * trade arrives twice. Showing both halves makes a quiet league look busy
     * and double-counts the feed.
     */
    const shared = { adds: ['p1'], drops: [] }
    activityFindMany.mockResolvedValue([
      { id: 'a1', activityType: 'trade', occurredAt: T('2026-08-24T10:00:00Z'), rosterId: null, payload: shared },
      { id: 'a2', activityType: 'trade', occurredAt: T('2026-08-24T10:00:00Z'), rosterId: null, payload: shared },
    ])

    const out = await getLeagueActivity(ARGS)
    expect(out!.items).toHaveLength(1)
  })

  it('names the manager the move belongs to', async () => {
    // Real rows carry no rosterId — the writer hardcodes it to null — so the
    // fixture reflects that and supplies the key the writer actually stores.
    activityFindMany.mockResolvedValue([
      {
        id: 'a1', activityType: 'waiver', occurredAt: T('2026-08-24T10:00:00Z'),
        rosterId: null, payload: { adds: ['p2'] },
        normalized: { managerKeys: ['sleeper:manager:sleeperU2'] },
      },
    ])
    const out = await getLeagueActivity(ARGS)
    expect(out!.items[0].managerName).toBe('Hustead')
    expect(out!.items[0].teamName).toBe('Theirs')
  })

  it('counts rows it cannot attribute rather than hiding them', async () => {
    activityFindMany.mockResolvedValue([
      { id: 'a1', activityType: 'waiver', occurredAt: T('2026-08-24T10:00:00Z'), rosterId: null, payload: { adds: ['p2'] } },
    ])
    const out = await getLeagueActivity(ARGS)
    expect(out!.unattributed).toBe(1)
    // The move is still shown — an unnamed manager is not a reason to drop it.
    expect(out!.items).toHaveLength(1)
  })

  it('⚠ keeps a player it cannot name as an id, never dropping him', async () => {
    // Silently omitting an unresolvable player turns a 2-for-1 into a 1-for-1.
    playerFindMany.mockResolvedValue([])
    activityFindMany.mockResolvedValue([
      { id: 'a1', activityType: 'trade', occurredAt: T('2026-08-24T10:00:00Z'), rosterId: null, payload: { adds: ['zz'] } },
    ])
    const out = await getLeagueActivity(ARGS)
    // Structured now, but the guarantee is unchanged: an id we hold no row for
    // still reaches the screen as `player zz` rather than vanishing from the
    // sentence, and every other field is an honest null rather than a guess.
    expect(out!.items[0].adds).toEqual([
      { id: 'zz', label: 'player zz', name: null, position: null, team: null, imageUrl: null },
    ])
  })

  it('reads adds/drops sent as an object, which is how Sleeper sends them', async () => {
    activityFindMany.mockResolvedValue([
      {
        id: 'a1',
        activityType: 'waiver',
        occurredAt: T('2026-08-24T10:00:00Z'),
        rosterId: null,
        payload: { adds: { p2: 1 }, drops: { p1: 1 } },
      },
    ])
    const out = await getLeagueActivity(ARGS)
    expect(out!.items[0].adds[0].label).toContain('Tyjae Spears')
    expect(out!.items[0].drops[0].label).toContain('Darren Waller')
  })

  it('labels draft picks in the language managers use', async () => {
    activityFindMany.mockResolvedValue([
      {
        id: 'a1',
        activityType: 'trade',
        occurredAt: T('2026-08-24T10:00:00Z'),
        rosterId: null,
        payload: { adds: [], draftPicks: [{ season: 2027, round: 4 }, { season: 2028, round: 1 }] },
      },
    ])
    const out = await getLeagueActivity(ARGS)
    expect(out!.items[0].picks).toEqual(['2027 4th', '2028 1st'])
  })

  it('returns null when the league genuinely has no activity', async () => {
    // Distinct from "we did not look" — the panel needs to tell those apart.
    activityFindMany.mockResolvedValue([])
    expect(await getLeagueActivity(ARGS)).toBeNull()
  })

  it('survives a database error without taking the panel down', async () => {
    activityFindMany.mockRejectedValueOnce(new Error('db down'))
    await expect(getLeagueActivity(ARGS)).resolves.toBeNull()
  })

  it('⚠ names the manager from managerKeys, because rosterId is ALWAYS null', async () => {
    /*
     * THE "A MANAGER" BUG. `prismaImportedActivityStore` writes
     * `rosterId: null` on every row — it is hardcoded. Joining on it meant no
     * row ever resolved, so every line in League Buzz read "A manager". The
     * writer's own comment calls `normalized.managerKeys` authoritative.
     */
    activityFindMany.mockResolvedValue([
      {
        id: 'a1',
        activityType: 'waiver',
        occurredAt: T('2026-08-24T10:00:00Z'),
        rosterId: null,
        payload: { adds: ['p2'] },
        normalized: { managerKeys: ['sleeper:manager:sleeperU2'] },
      },
    ])
    const out = await getLeagueActivity(ARGS)
    expect(out!.items[0].managerName).toBe('Hustead')
    expect(out!.unattributed).toBe(0)
  })

  it('resolves an AF user id as a manager key too', async () => {
    // A claimed team is identified by our own id, not the platform's.
    activityFindMany.mockResolvedValue([
      {
        id: 'a1', activityType: 'waiver', occurredAt: T('2026-08-24T10:00:00Z'),
        rosterId: null, payload: { adds: ['p2'] },
        normalized: { managerKeys: ['af-user-1'] },
      },
    ])
    const out = await getLeagueActivity(ARGS)
    expect(out!.items[0].teamName).toBe('Yours')
    expect(out!.items[0].avatarUrl).toBe('https://cdn/a.png')
  })

  it('falls back to the key tail for a provider prefix it does not know', async () => {
    activityFindMany.mockResolvedValue([
      {
        id: 'a1', activityType: 'waiver', occurredAt: T('2026-08-24T10:00:00Z'),
        rosterId: null, payload: { adds: ['p2'] },
        normalized: { managerKeys: ['espn:manager:sleeperU2'] },
      },
    ])
    const out = await getLeagueActivity(ARGS)
    expect(out!.items[0].managerName).toBe('Hustead')
  })

  it('still counts a row it genuinely cannot attribute', async () => {
    activityFindMany.mockResolvedValue([
      {
        id: 'a1', activityType: 'waiver', occurredAt: T('2026-08-24T10:00:00Z'),
        rosterId: null, payload: { adds: ['p2'] },
        normalized: { managerKeys: ['sleeper:manager:someone-else'] },
      },
    ])
    const out = await getLeagueActivity(ARGS)
    expect(out!.unattributed).toBe(1)
    // Shown anyway — an unnamed manager is not a reason to drop the move.
    expect(out!.items).toHaveLength(1)
  })
})

describe('league buzz: faces and bids', () => {
  /** One waiver row carrying whatever payload the case needs. */
  async function one(payload: Record<string, unknown>) {
    activityFindMany.mockResolvedValue([
      {
        id: 'a1',
        activityType: 'waiver',
        occurredAt: T('2026-08-24T10:00:00Z'),
        rosterId: null,
        payload,
      },
    ])
    const out = await getLeagueActivity(ARGS)
    return out!.items[0]
  }

  it('carries the headshot through, so the feed can show who moved', async () => {
    const item = await one({ adds: ['p2'] })
    expect(item.adds[0].imageUrl).toBe('https://img/p2.png')
    expect(item.adds[0].name).toBe('Tyjae Spears')
  })

  it('\u26a0 a row with no recorded bid reports null, which must never render as $0', async () => {
    /*
     * Every row written before the emitter started copying transaction settings
     * has no bid on it, and there is no backfill \u2014 the source transactions
     * are not retained. A missing bid and a $0 bid are different facts.
     */
    expect((await one({ adds: ['p2'] })).bid).toBeNull()
  })

  it('reads the bid whether it is nested under settings or flattened', async () => {
    expect((await one({ adds: ['p2'], settings: { waiver_bid: 47 } })).bid).toBe(47)
    expect((await one({ adds: ['p2'], waiverBid: 12 })).bid).toBe(12)
  })

  it('\u26a0 keeps a zero bid, because $0 is a real claim', async () => {
    // An uncontested $0 claim is the most common waiver in most leagues. A
    // reader treating 0 as falsy would report it as "no bid recorded".
    expect((await one({ adds: ['p2'], settings: { waiver_bid: 0 } })).bid).toBe(0)
  })
})
