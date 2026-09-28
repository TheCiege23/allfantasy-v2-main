/**
 * A roster in another platform's id space must never be read as Sleeper ids.
 *
 * 🛑 MEASURED ON PRODUCTION 2026-09-27: 44 of the 248 ids on the one Fleaflicker league's rosters
 * are also real Sleeper ids. Fleaflicker, MFL, Fantrax and Yahoo rosters arrive under the provider's
 * own numbers, and only ESPN has a bridge to Sleeper ids, so a raw `includes(sleeperId)` told a
 * manager he rosters a player he does not (the collision is a HIT, so the no-hit coverage guard
 * never saw it), and `getPlayerImpact` priced a swap for the wrong player.
 *
 * The fixture is that shape: player "1234" (Sleeper id) is on the manager's Sleeper roster and,
 * under his ESPN id, on the ESPN roster — and "1234" ALSO appears on both Fleaflicker rosters as a
 * Fleaflicker id belonging to somebody else entirely.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type AnyArgs = Record<string, any>

const HIM = '1234'
const HIS_ESPN_ID = '3139477'

const LEAGUES = [
  { id: 'S', name: 'Sleeper League', platform: 'sleeper', leagueType: 'redraft', platformLeagueId: 's1', season: 2026, settings: {} },
  { id: 'E', name: 'ESPN League', platform: 'espn', leagueType: 'redraft', platformLeagueId: 'e1', season: 2026, settings: {} },
  { id: 'F', name: 'Flea League', platform: 'fleaflicker', leagueType: 'redraft', platformLeagueId: 'f1', season: 2026, settings: {} },
  { id: 'F2', name: 'Flea Rivals', platform: 'fleaflicker', leagueType: 'redraft', platformLeagueId: 'f2', season: 2026, settings: {} },
]
const byId = new Map(LEAGUES.map((l) => [l.id, l]))

/** Your team in S, E and F; F2 is a league you play but hold no claimed team in. */
const CLAIMED = [
  { leagueId: 'S', platformUserId: 'me-s', externalId: '1' },
  { leagueId: 'E', platformUserId: 'me-e', externalId: '2' },
  { leagueId: 'F', platformUserId: 'me-f', externalId: '3' },
]
const ROSTERS = [
  { leagueId: 'S', platformUserId: 'me-s', playerData: { players: [HIM, '9'], starters: [HIM] } },
  { leagueId: 'E', platformUserId: 'me-e', playerData: { players: [HIS_ESPN_ID, '4241457'], starters: [HIS_ESPN_ID] } },
  // "1234" here is a FLEAFLICKER id — a different player who shares the number.
  { leagueId: 'F', platformUserId: 'me-f', playerData: { players: [HIM, '777'], starters: [HIM] } },
  { leagueId: 'F2', platformUserId: 'rival', playerData: { players: [HIM, '888'], starters: [HIM] } },
]

const db = vi.hoisted(() => ({
  leagueTeam: { findMany: vi.fn() },
  league: { findMany: vi.fn() },
  roster: { findMany: vi.fn(), findFirst: vi.fn() },
  sportsPlayer: { findMany: vi.fn() },
  playerIdentityMap: { findMany: vi.fn() },
  fantasyProjection: { findMany: vi.fn() },
  sportsInjury: { findMany: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/core-app/playerProjections', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  latestProjectionWeek: vi.fn(async () => ({ season: '2026', week: 4 })),
}))

import { resolveLeagueSlots } from '@/lib/core-app/playerFinder'
import { getPlayerImpact } from '@/lib/core-app/playerImpact'

beforeEach(() => {
  vi.clearAllMocks()
  db.leagueTeam.findMany.mockImplementation(async ({ where, select }: AnyArgs) => {
    const wanted: string[] | undefined = where.leagueId?.in
    const rows = where.claimedByUserId ? CLAIMED : []
    return rows
      .filter((t) => !wanted || wanted.includes(t.leagueId))
      .map((t) => (select?.league ? { ...t, league: byId.get(t.leagueId) } : t))
  })
  db.league.findMany.mockImplementation(async ({ where }: AnyArgs) => LEAGUES.filter((l) => where.id.in.includes(l.id)))
  db.roster.findMany.mockImplementation(async ({ where }: AnyArgs) =>
    ROSTERS.filter(
      (r) => where.leagueId.in.includes(r.leagueId) && (!where.platformUserId || where.platformUserId.in.includes(r.platformUserId)),
    ),
  )
  db.roster.findFirst.mockImplementation(async ({ where }: AnyArgs) =>
    ROSTERS.find((r) => r.leagueId === where.leagueId && where.platformUserId.in.includes(r.platformUserId)) ?? null,
  )
  // Every Sleeper id in the fixture is a real player we know.
  db.sportsPlayer.findMany.mockImplementation(async ({ where }: AnyArgs) =>
    (where.sleeperId.in as string[])
      .filter((id) => [HIM, '9', '777', '888'].includes(id))
      .map((sleeperId) => ({ sleeperId, name: `P${sleeperId}`, position: 'RB', team: 'BUF' })),
  )
  db.playerIdentityMap.findMany.mockImplementation(async ({ where }: AnyArgs) =>
    (where.espnId.in as string[]).includes(HIS_ESPN_ID) ? [{ espnId: HIS_ESPN_ID, sleeperId: HIM }] : [],
  )
  db.fantasyProjection.findMany.mockResolvedValue([])
  db.sportsInjury.findMany.mockResolvedValue([])
})

describe('resolveLeagueSlots — which of your leagues roster him', () => {
  it('finds him on Sleeper and, through the identity chain, on ESPN — never on a Fleaflicker id that shares his number', async () => {
    const { slots, unmatched } = await resolveLeagueSlots(HIM, ['S', 'E', 'F', 'F2'], 'u1')

    expect(slots.map((s) => [s.leagueId, s.isYours]).sort()).toEqual([
      ['E', true],
      ['S', true],
    ])
    // Neither the manager's Fleaflicker roster nor a rival's is read — both are named as unchecked instead.
    expect(unmatched.map((u) => [u.leagueId, u.platform]).sort()).toEqual([
      ['F', 'fleaflicker'],
      ['F2', 'fleaflicker'],
    ])
  })

  it('a foreign-id league with nothing imported is not reported as unchecked', async () => {
    const withoutF2 = ROSTERS.filter((r) => r.leagueId !== 'F2')
    db.roster.findMany.mockImplementation(async ({ where }: AnyArgs) =>
      withoutF2.filter(
        (r) => where.leagueId.in.includes(r.leagueId) && (!where.platformUserId || where.platformUserId.in.includes(r.platformUserId)),
      ),
    )
    const { unmatched } = await resolveLeagueSlots(HIM, ['S', 'F', 'F2'], 'u1')
    expect(unmatched.map((u) => u.leagueId)).toEqual(['F'])
  })
})

describe('getPlayerImpact — the per-league answer', () => {
  it('answers for his Sleeper AND ESPN leagues, and never prices a swap on a Fleaflicker collision', async () => {
    const rows = await getPlayerImpact(HIM, 'u1', { leagueIds: ['S', 'E', 'F'] })
    expect(rows.map((r) => r.leagueId).sort()).toEqual(['E', 'S'])
    expect(rows.every((r) => r.isStarting)).toBe(true)
  })

  it('never reads a foreign-id roster at all', async () => {
    await getPlayerImpact(HIM, 'u1', { leagueIds: ['F'] })
    expect(db.roster.findFirst).not.toHaveBeenCalled()
  })
})
