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
    { externalId: '1', teamName: 'Yours', ownerName: 'chxnk', avatarUrl: null },
    { externalId: '2', teamName: 'Theirs', ownerName: 'Hustead', avatarUrl: null },
  ])
  playerFindMany.mockResolvedValue([
    { sleeperId: 'p1', name: 'Darren Waller', position: 'TE', team: 'CAR' },
    { sleeperId: 'p2', name: 'Tyjae Spears', position: 'RB', team: 'TEN' },
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
        rosterId: '1',
        payload: { adds: ['p2'], drops: [] },
      },
    ])

    const out = await getLeagueActivity(ARGS)
    expect(out!.items).toHaveLength(1)
    expect(out!.counts.waiver).toBe(1)
    expect(out!.items[0].adds[0]).toContain('Tyjae Spears')
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
      { id: 'a1', activityType: 'trade', occurredAt: T('2026-08-24T10:00:00Z'), rosterId: '1', payload: shared },
      { id: 'a2', activityType: 'trade', occurredAt: T('2026-08-24T10:00:00Z'), rosterId: '2', payload: shared },
    ])

    const out = await getLeagueActivity(ARGS)
    expect(out!.items).toHaveLength(1)
  })

  it('names the manager the move belongs to', async () => {
    activityFindMany.mockResolvedValue([
      { id: 'a1', activityType: 'waiver', occurredAt: T('2026-08-24T10:00:00Z'), rosterId: '2', payload: { adds: ['p2'] } },
    ])
    const out = await getLeagueActivity(ARGS)
    expect(out!.items[0].managerName).toBe('Hustead')
    expect(out!.items[0].teamName).toBe('Theirs')
  })

  it('counts rows it cannot attribute rather than hiding them', async () => {
    activityFindMany.mockResolvedValue([
      { id: 'a1', activityType: 'waiver', occurredAt: T('2026-08-24T10:00:00Z'), rosterId: '99', payload: { adds: ['p2'] } },
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
      { id: 'a1', activityType: 'trade', occurredAt: T('2026-08-24T10:00:00Z'), rosterId: '1', payload: { adds: ['zz'] } },
    ])
    const out = await getLeagueActivity(ARGS)
    expect(out!.items[0].adds).toEqual(['player zz'])
  })

  it('reads adds/drops sent as an object, which is how Sleeper sends them', async () => {
    activityFindMany.mockResolvedValue([
      {
        id: 'a1',
        activityType: 'waiver',
        occurredAt: T('2026-08-24T10:00:00Z'),
        rosterId: '1',
        payload: { adds: { p2: 1 }, drops: { p1: 1 } },
      },
    ])
    const out = await getLeagueActivity(ARGS)
    expect(out!.items[0].adds[0]).toContain('Tyjae Spears')
    expect(out!.items[0].drops[0]).toContain('Darren Waller')
  })

  it('labels draft picks in the language managers use', async () => {
    activityFindMany.mockResolvedValue([
      {
        id: 'a1',
        activityType: 'trade',
        occurredAt: T('2026-08-24T10:00:00Z'),
        rosterId: '1',
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
})
