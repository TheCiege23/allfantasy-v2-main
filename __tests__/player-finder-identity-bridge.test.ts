/**
 * Phase 4 (2026-09-27): a Fleaflicker/MFL league the identity bridge can read is searched in Sleeper
 * ids — and only then.
 *
 * `PlayerIdentityMap.fleaflickerId` / `.mflId` map a provider's roster ids to Sleeper ids
 * (bridgedRosterIds.ts). Three rules pinned here:
 *   - a league most of whose ids translate is READ, through the bridge;
 *   - an unbridged id is DROPPED, never kept raw — a raw provider id is the collision #1433 fixed;
 *   - a readable league still cannot see a player the bridge does not know, so for him it is named
 *     unchecked rather than claimed empty.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type AnyArgs = Record<string, any>

const HIM = '1234'
/** Fleaflicker id → Sleeper id. "1234" as a FLEAFLICKER id belongs to nobody we can bridge. */
const BRIDGE: Record<string, string> = {
  FL900: HIM, FL901: '9', FL902: '10', FL903: '11', FL904: '12', FL905: '13', FL906: '14', FL907: '15', FL908: '16',
  // League C: only half its ids bridge.
  FL950: '50',
}

const LEAGUES = [
  { id: 'B', name: 'Flea Readable', platform: 'fleaflicker', leagueType: 'redraft', platformLeagueId: 'b', season: 2026, settings: {} },
  { id: 'C', name: 'Flea Thin', platform: 'fleaflicker', leagueType: 'redraft', platformLeagueId: 'c', season: 2026, settings: {} },
]
const byId = new Map(LEAGUES.map((l) => [l.id, l]))
const CLAIMED = [
  { leagueId: 'B', platformUserId: 'me-b', externalId: '1' },
  { leagueId: 'C', platformUserId: 'me-c', externalId: '2' },
]
const ROSTERS = [
  { leagueId: 'B', platformUserId: 'me-b', playerData: { players: ['FL900', 'FL901', 'FL902', 'FL903', 'FL904'], starters: ['FL900'] } },
  // The rival holds a RAW "1234": a Fleaflicker id with no bridge. 9 of 10 ids in B bridge.
  { leagueId: 'B', platformUserId: 'rival', playerData: { players: ['1234', 'FL905', 'FL906', 'FL907', 'FL908'], starters: ['FL905'] } },
  { leagueId: 'C', platformUserId: 'me-c', playerData: { players: ['FL950', 'raw-1'], starters: ['FL950'] } },
]
const OWNERS = [{ leagueId: 'B', platformUserId: 'rival', externalId: '7', ownerName: 'Rival', teamName: 'Rivals', avatarUrl: null }]

const db = vi.hoisted(() => ({
  leagueTeam: { findMany: vi.fn() },
  league: { findMany: vi.fn() },
  roster: { findMany: vi.fn(), findFirst: vi.fn() },
  sportsPlayer: { findMany: vi.fn() },
  playerIdentityMap: { findMany: vi.fn(), findUnique: vi.fn() },
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
import { applyBridge, bridgeCoverageReadable } from '@/lib/core-app/bridgedRosterIds'

beforeEach(() => {
  vi.clearAllMocks()
  db.leagueTeam.findMany.mockImplementation(async ({ where, select }: AnyArgs) => {
    const wanted: string[] | undefined = where.leagueId?.in
    const rows = where.claimedByUserId ? CLAIMED : OWNERS
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
  db.sportsPlayer.findMany.mockImplementation(async ({ where }: AnyArgs) =>
    (where.sleeperId.in as string[]).map((sleeperId) => ({ sleeperId, name: `P${sleeperId}`, position: 'RB', team: 'BUF' })),
  )
  db.playerIdentityMap.findMany.mockImplementation(async ({ where }: AnyArgs) => {
    const ids: string[] = where.fleaflickerId?.in ?? []
    return ids.filter((id) => BRIDGE[id]).map((id) => ({ fleaflickerId: id, sleeperId: BRIDGE[id] }))
  })
  db.playerIdentityMap.findUnique.mockImplementation(async ({ where }: AnyArgs) => {
    const fl = Object.entries(BRIDGE).find(([, s]) => s === where.sleeperId)?.[0] ?? null
    return fl ? { fleaflickerId: fl, mflId: null } : null
  })
  db.fantasyProjection.findMany.mockResolvedValue([])
  db.sportsInjury.findMany.mockResolvedValue([])
})

describe('resolveLeagueSlots through the identity bridge', () => {
  it('reads a league that mostly translates: finds him on your roster by his Fleaflicker id', async () => {
    const { slots, unmatched } = await resolveLeagueSlots(HIM, ['B'], 'u1')
    expect(slots.map((s) => [s.leagueId, s.isYours, s.slot])).toEqual([['B', true, 'STARTER']])
    expect(unmatched).toEqual([])
  })

  it('names the rival who holds a bridged player', async () => {
    const { slots } = await resolveLeagueSlots('13', ['B'], 'u1')
    expect(slots).toMatchObject([{ leagueId: 'B', isYours: false, owner: { ownerName: 'Rival' } }])
  })

  it('drops an unbridged raw id instead of reading it as the Sleeper player who shares the number', async () => {
    // Nobody rosters Sleeper player "1234" in B except you — the rival's raw "1234" is a different
    // Fleaflicker player. Take him off your roster and B must say "not here", not "the rival has him".
    const mine = ROSTERS[0]!
    db.roster.findMany.mockImplementation(async ({ where }: AnyArgs) =>
      ROSTERS.map((r) => (r === mine ? { ...r, playerData: { players: ['FL901', 'FL902', 'FL903', 'FL904'], starters: [] } } : r)).filter(
        (r) => where.leagueId.in.includes(r.leagueId) && (!where.platformUserId || where.platformUserId.in.includes(r.platformUserId)),
      ),
    )
    const { slots, unmatched } = await resolveLeagueSlots(HIM, ['B'], 'u1')
    expect(slots).toEqual([])
    expect(unmatched).toEqual([])
  })

  it('a readable league cannot see a player the bridge does not know — it says so for him', async () => {
    const { slots, unmatched } = await resolveLeagueSlots('555', ['B'], 'u1')
    expect(slots).toEqual([])
    expect(unmatched.map((u) => u.leagueId)).toEqual(['B'])
  })

  it('a league too thinly bridged is not read at all', async () => {
    const { slots, unmatched } = await resolveLeagueSlots('50', ['C'], 'u1')
    expect(slots).toEqual([])
    expect(unmatched.map((u) => u.leagueId)).toEqual(['C'])
  })
})

describe('getPlayerImpact through the identity bridge', () => {
  it('answers for a readable bridged league, and never for a thin one', async () => {
    const rows = await getPlayerImpact(HIM, 'u1', { leagueIds: ['B', 'C'] })
    expect(rows.map((r) => [r.leagueId, r.isStarting])).toEqual([['B', true]])
    // The thin league's roster is never even fetched for the answer.
    expect(db.roster.findFirst.mock.calls.map((c) => c[0].where.leagueId)).toEqual(['B'])
  })
})

describe('applyBridge / bridgeCoverageReadable', () => {
  it('replaces bridged ids and drops the rest, leaving other keys alone', () => {
    expect(applyBridge({ players: ['FL900', '1234', null], starters: ['FL900'], name: 'x' }, new Map([['FL900', HIM]]))).toEqual({
      players: [HIM],
      starters: [HIM],
      name: 'x',
    })
  })

  it('reads a league only at or above the coverage bar', () => {
    expect(bridgeCoverageReadable(9, 10)).toBe(true)
    expect(bridgeCoverageReadable(8, 10)).toBe(true)
    expect(bridgeCoverageReadable(1, 2)).toBe(false)
    expect(bridgeCoverageReadable(0, 0)).toBe(false)
  })
})

describe('applyBridgeKeepingSlots — the roster shape a lineup reader needs', () => {
  it('keeps empty slots and unbridged players IN PLACE, so starter slot order survives', async () => {
    const { applyBridgeKeepingSlots, isUnbridgedId } = await import('@/lib/core-app/bridgedRosterIds')
    const out = applyBridgeKeepingSlots(
      { starters: ['11', '0', '22', '33'], players: ['11', '22', '33'], settings: { keep: true } },
      new Map([['11', 's11'], ['33', 's33']]),
    )
    expect(out.starters).toEqual(['s11', '0', 'unbridged:22', 's33'])
    expect(out.players).toEqual(['s11', 'unbridged:22', 's33'])
    expect(out.settings).toEqual({ keep: true })
    expect(isUnbridgedId('unbridged:22')).toBe(true)
    expect(isUnbridgedId('22')).toBe(false)
  })
})

/*
 * 🛑 A PASTED YAHOO LEAGUE (2026-11-26). The paste import stores each resolved player DECLARED
 * (`sleeper:<id>`, declaredSleeperId.ts) and an unmatched one as `yahoo-paste:<name|pos|team>`. The
 * finder and the impact read used to treat every Yahoo league as unreadable. Now the declared ids
 * are its bridge — read with NO registry query — under the same coverage rule as Fleaflicker; an
 * unmatched player gets no id, and a BARE number on a Yahoo roster is still never a Sleeper id.
 */
describe('a pasted Yahoo league reads through its declared Sleeper ids', () => {
  const YAHOO = [
    { id: 'Y', name: 'Yahoo Paste', platform: 'yahoo', leagueType: 'redraft', platformLeagueId: 'y', season: 2026, settings: {} },
    { id: 'YT', name: 'Yahoo Thin', platform: 'yahoo', leagueType: 'redraft', platformLeagueId: 'yt', season: 2026, settings: {} },
  ]
  const YAHOO_ROSTERS = [
    // 9 of 10 ids declared; the rival's one unmatched player keeps his paste id.
    { leagueId: 'Y', platformUserId: 'me-y', playerData: { players: [`sleeper:${HIM}`, 'sleeper:9', 'sleeper:10', 'sleeper:11', 'sleeper:12'], starters: [`sleeper:${HIM}`] } },
    { leagueId: 'Y', platformUserId: 'rival', playerData: { players: ['yahoo-paste:some guy|wr|kc', 'sleeper:13', 'sleeper:14', 'sleeper:15', 'sleeper:16'], starters: ['sleeper:13'] } },
    // A BARE id from any other Yahoo import: "50" IS a Sleeper id, and must not be read as one.
    { leagueId: 'YT', platformUserId: 'me-yt', playerData: { players: ['50', 'sleeper:51', '52'], starters: ['50'] } },
  ]
  const yahooById = new Map(YAHOO.map((l) => [l.id, l]))

  beforeEach(() => {
    db.leagueTeam.findMany.mockImplementation(async ({ where, select }: AnyArgs) => {
      const wanted: string[] | undefined = where.leagueId?.in
      const rows = where.claimedByUserId
        ? [{ leagueId: 'Y', platformUserId: 'me-y', externalId: '1' }, { leagueId: 'YT', platformUserId: 'me-yt', externalId: '2' }]
        : [{ leagueId: 'Y', platformUserId: 'rival', externalId: '7', ownerName: 'Rival', teamName: 'Rivals', avatarUrl: null }]
      return rows
        .filter((t) => !wanted || wanted.includes(t.leagueId))
        .map((t) => (select?.league ? { ...t, league: yahooById.get(t.leagueId) } : t))
    })
    db.league.findMany.mockImplementation(async ({ where }: AnyArgs) => YAHOO.filter((l) => where.id.in.includes(l.id)))
    db.roster.findMany.mockImplementation(async ({ where }: AnyArgs) =>
      YAHOO_ROSTERS.filter(
        (r) => where.leagueId.in.includes(r.leagueId) && (!where.platformUserId || where.platformUserId.in.includes(r.platformUserId)),
      ),
    )
    db.roster.findFirst.mockImplementation(async ({ where }: AnyArgs) =>
      YAHOO_ROSTERS.find((r) => r.leagueId === where.leagueId && where.platformUserId.in.includes(r.platformUserId)) ?? null,
    )
    db.playerIdentityMap.findUnique.mockResolvedValue(null)
  })

  it('finds him on your roster by his declared id', async () => {
    const { slots, unmatched } = await resolveLeagueSlots(HIM, ['Y'], 'u1')
    expect(slots.map((s) => [s.leagueId, s.isYours, s.slot])).toEqual([['Y', true, 'STARTER']])
    expect(unmatched).toEqual([])
  })

  it('names the rival who holds a declared player', async () => {
    const { slots } = await resolveLeagueSlots('13', ['Y'], 'u1')
    expect(slots).toMatchObject([{ leagueId: 'Y', isYours: false, owner: { ownerName: 'Rival' } }])
  })

  it('a readable Yahoo league can say "not here" for a player nobody holds', async () => {
    const { slots, unmatched } = await resolveLeagueSlots('777', ['Y'], 'u1')
    expect(slots).toEqual([])
    expect(unmatched).toEqual([])
  })

  it('🛑 a bare id on a Yahoo roster is never read as the Sleeper player who shares it', async () => {
    const { slots, unmatched } = await resolveLeagueSlots('50', ['YT'], 'u1')
    expect(slots).toEqual([])
    // 1 of 3 ids declared: below the coverage bar, so the league is named unchecked, not "not here".
    expect(unmatched.map((u) => u.leagueId)).toEqual(['YT'])
  })

  it('reads the declared ids without asking the identity registry by a "declared" column', async () => {
    await resolveLeagueSlots(HIM, ['Y'], 'u1')
    const asked = db.playerIdentityMap.findMany.mock.calls.flatMap((c) => Object.keys(c[0]?.where ?? {}))
    expect(asked).not.toContain('declared')
  })

  it('getPlayerImpact answers for the readable Yahoo league and never for the thin one', async () => {
    const rows = await getPlayerImpact(HIM, 'u1', { leagueIds: ['Y', 'YT'] })
    expect(rows.map((r) => [r.leagueId, r.isStarting])).toEqual([['Y', true]])
  })

  it('loadBridgedLeagues: declared ids map to bare Sleeper ids; paste and bare ids stay unbridged', async () => {
    const { loadBridgedLeagues } = await import('@/lib/core-app/bridgedRosterIds')
    const out = await loadBridgedLeagues(YAHOO)
    const y = out.get('Y')!
    expect(y).toMatchObject({ column: 'declared', total: 10, translated: 9, readable: true })
    expect(y.map.get(`sleeper:${HIM}`)).toBe(HIM)
    expect(y.map.has('yahoo-paste:some guy|wr|kc')).toBe(false)
    const yt = out.get('YT')!
    expect(yt).toMatchObject({ total: 3, translated: 1, readable: false })
    expect(yt.map.has('50')).toBe(false)
    expect(applyBridge(YAHOO_ROSTERS[1]!.playerData, y.map).players).toEqual(['13', '14', '15', '16'])
  })
})
