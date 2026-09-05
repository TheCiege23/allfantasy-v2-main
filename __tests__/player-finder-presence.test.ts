import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Player Finder — the trade window's loader: who to pitch for a player in a
 * league, and when they usually move.
 *
 * Prisma is mocked at the module boundary; the window maths, the coverage
 * guard and position normalization are the real ones. The fixture league is
 * Gridiron Gang on Sleeper: Tasha holds Kincaid and moves on Sunday mornings,
 * Mike is thin at TE and moves on Tuesday evenings, Drew hoards three TEs.
 */

const mockLeagueFindUnique = vi.hoisted(() => vi.fn())
const mockTeamFindMany = vi.hoisted(() => vi.fn())
const mockRosterFindMany = vi.hoisted(() => vi.fn())
const mockActivityFindMany = vi.hoisted(() => vi.fn())
const mockSportsPlayerFindMany = vi.hoisted(() => vi.fn())
const mockSportsPlayerFindFirst = vi.hoisted(() => vi.fn())
const mockProfileFindMany = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: mockLeagueFindUnique },
    leagueTeam: { findMany: mockTeamFindMany },
    roster: { findMany: mockRosterFindMany },
    decisionOsImportedActivity: { findMany: mockActivityFindMany },
    sportsPlayer: { findMany: mockSportsPlayerFindMany, findFirst: mockSportsPlayerFindFirst },
    userProfile: { findMany: mockProfileFindMany },
  },
}))

import { getManagerPresence, MAX_BUYERS } from '@/lib/core-app/managerPresence'

const KINCAID = '10236'

const LEAGUE = {
  id: 'L-gang',
  name: 'Gridiron Gang',
  platform: 'sleeper',
  platformLeagueId: '123456',
  season: 2026,
  timezone: 'America/New_York',
  settings: { roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'BN', 'BN'] },
}

const TASHA = { externalId: '1', platformUserId: 'sl-tasha', claimedByUserId: null, ownerName: 'tashaR', teamName: "Tasha's Titans", avatarUrl: null, wins: 4, losses: 2, ties: 0, pointsFor: 800, currentRank: 3 }
const ME = { ...TASHA, externalId: '2', platformUserId: 'sl-me', claimedByUserId: 'me', ownerName: 'guap', teamName: 'Cafe Con Chimmy', wins: 5, losses: 1, pointsFor: 900, currentRank: 1 }
const MIKE = { ...TASHA, externalId: '3', platformUserId: 'sl-mike', ownerName: 'mikeD', teamName: 'Mike Mayhem', wins: 3, losses: 3, pointsFor: 700, currentRank: 5 }
const DREW = { ...TASHA, externalId: '4', platformUserId: 'sl-drew', ownerName: 'drew', teamName: 'Drew Crew', wins: 2, losses: 4, pointsFor: 600, currentRank: 8 }

/** Every id the rosters speak, with a position — so the coverage guard passes and needs can be counted. */
const POSITIONS: Record<string, string> = {
  [KINCAID]: 'TE',
  '50': 'RB',
  '51': 'TE',
  '60': 'QB',
  '70': 'RB',
  '71': 'WR',
  '80': 'TE',
  '81': 'TE',
  '82': 'TE',
}

const ROSTERS = [
  { platformUserId: 'sl-tasha', playerData: { players: [KINCAID, '50', '51'], starters: [KINCAID, '50'] } },
  { platformUserId: 'sl-me', playerData: { players: ['60'], starters: ['60'] } },
  { platformUserId: 'sl-mike', playerData: { players: ['70', '71'], starters: ['70'] } },
  { platformUserId: 'sl-drew', playerData: { players: ['80', '81', '82'], starters: ['80'] } },
]

function utc(date: string, hhmm: string): Date {
  return new Date(`${date}T${hhmm}:00Z`)
}
const SUNDAYS = ['2026-09-13', '2026-09-20', '2026-09-27', '2026-10-04', '2026-10-11', '2026-10-18']
const TUESDAYS = ['2026-09-15', '2026-09-22', '2026-09-29', '2026-10-06']

/** One row per move, keyed the way the ingest keys them: `sleeper:<id>` or the AF user id. */
function activity(): Array<{ occurredAt: Date; activityType: string; normalized: unknown }> {
  const rows = [
    // Tasha: Sunday mornings (10:15a / 11:40a ET), keyed by her stable Sleeper key; one trade last week.
    ...SUNDAYS.map((d) => ({ occurredAt: utc(d, '14:15'), activityType: 'waiver', normalized: { managerKeys: ['sleeper:sl-tasha'] } })),
    ...SUNDAYS.map((d) => ({ occurredAt: utc(d, '15:40'), activityType: 'roster_move', normalized: { managerKeys: ['sleeper:sl-tasha'] } })),
    { occurredAt: utc('2026-10-20', '18:00'), activityType: 'trade', normalized: { managerKeys: ['sleeper:sl-tasha', 'af-mike'] } },
    // Mike: Tuesday evenings, keyed by his AllFantasy user id (resolved through his profile's Sleeper id).
    ...TUESDAYS.map((d) => ({ occurredAt: utc(d, '23:10'), activityType: 'waiver', normalized: { managerKeys: ['af-mike'] } })),
    ...TUESDAYS.map((d) => ({ occurredAt: utc(d, '22:20'), activityType: 'roster_move', normalized: { managerKeys: ['af-mike'] } })),
    // Two moves nobody can be matched to.
    { occurredAt: utc('2026-09-16', '12:00'), activityType: 'roster_move', normalized: { managerKeys: ['ghost'] } },
    { occurredAt: utc('2026-09-17', '12:00'), activityType: 'waiver', normalized: { managerKeys: [] } },
  ]
  return rows.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
}

beforeEach(() => {
  vi.clearAllMocks()
  mockLeagueFindUnique.mockResolvedValue(LEAGUE)
  mockTeamFindMany.mockResolvedValue([TASHA, ME, MIKE, DREW])
  mockRosterFindMany.mockResolvedValue(ROSTERS)
  mockActivityFindMany.mockResolvedValue(activity())
  mockSportsPlayerFindMany.mockImplementation(async (args: { where: { sleeperId: { in: string[] } } }) =>
    args.where.sleeperId.in.filter((id) => POSITIONS[id]).map((id) => ({ sleeperId: id, position: POSITIONS[id] })),
  )
  mockSportsPlayerFindFirst.mockResolvedValue({ position: 'TE' })
  mockProfileFindMany.mockResolvedValue([{ userId: 'af-mike', sleeperUserId: 'sl-mike' }])
})

describe('getManagerPresence — someone else has him', () => {
  it('names the owner, their window, their last move, and what they do with him', async () => {
    const res = await getManagerPresence('L-gang', KINCAID, 'me', { position: 'TE' })
    expect(res.available).toBe(true)
    if (!res.available) return
    const p = res.data
    expect(p).toMatchObject({ leagueName: 'Gridiron Gang', platform: 'sleeper', holder: 'other', zone: 'ET', timeZone: 'America/New_York', activityIngested: true, unattributed: 2 })
    expect(p.newestMove).toBe('2026-10-20T18:00:00.000Z')
    expect(p.managers).toHaveLength(1)
    const owner = p.managers[0]
    expect(owner).toMatchObject({ role: 'owner', ownerName: 'tashaR', teamName: "Tasha's Titans", externalId: '1', record: '4-2', rank: 3, startsHim: true, need: null, moves: 13 })
    expect(owner.window).toMatchObject({ weekday: 0, startHour: 10, endHour: 12, precision: 'window', zone: 'ET' })
    expect(owner.lastMove).toEqual({ at: '2026-10-20T18:00:00.000Z', kind: 'trade' })
  })

  it('reads the key shapes the ingest writes — a stable Sleeper key and an AllFantasy user id', async () => {
    await getManagerPresence('L-gang', KINCAID, 'me', { position: 'TE' })
    // Only the keys nothing matched directly are looked up; 'ghost' is asked about and stays unresolved.
    expect(mockProfileFindMany).toHaveBeenCalledTimes(1)
    const asked = mockProfileFindMany.mock.calls[0][0].where.userId.in as string[]
    expect(asked).toEqual(expect.arrayContaining(['af-mike', 'ghost']))
    expect(asked).not.toContain('sleeper:sl-tasha')
  })
})

describe('getManagerPresence — he is yours', () => {
  beforeEach(() => {
    mockRosterFindMany.mockResolvedValue([
      { platformUserId: 'sl-tasha', playerData: { players: ['50', '51'], starters: ['50'] } },
      { platformUserId: 'sl-me', playerData: { players: ['60', KINCAID], starters: ['60', KINCAID] } },
      ROSTERS[2],
      ROSTERS[3],
    ])
  })

  it('lists the buyers thinnest-first at his position, never you, capped', async () => {
    const res = await getManagerPresence('L-gang', KINCAID, 'me', { position: 'TE' })
    expect(res.available).toBe(true)
    if (!res.available) return
    expect(res.data.holder).toBe('yours')
    const buyers = res.data.managers
    expect(buyers.length).toBeLessThanOrEqual(MAX_BUYERS)
    expect(buyers.map((b) => b.ownerName)).toEqual(['mikeD', 'tashaR', 'drew'])
    expect(buyers[0]).toMatchObject({ role: 'buyer', need: { position: 'TE', held: 0, starters: 1, level: 'thin' }, record: '3-3', rank: 5, startsHim: null })
    expect(buyers[1].need).toEqual({ position: 'TE', held: 1, starters: 1, level: 'thin' })
    expect(buyers[2].need).toEqual({ position: 'TE', held: 3, starters: 1, level: 'deep' })
    // Mike's Tuesday evenings came through his AllFantasy id.
    expect(buyers[0].window).toMatchObject({ weekday: 2, precision: 'window', zone: 'ET' })
    expect(buyers[0].moves).toBe(9)
  })

  it('looks his position up when the caller did not pass one', async () => {
    const res = await getManagerPresence('L-gang', KINCAID, 'me')
    expect(mockSportsPlayerFindFirst).toHaveBeenCalledWith({ where: { sleeperId: KINCAID }, select: { position: true } })
    expect(res.available && res.data.player.position).toBe('TE')
  })
})

describe('getManagerPresence — nothing to pitch', () => {
  it('a free agent has nobody to pitch, and says to claim him', async () => {
    mockRosterFindMany.mockResolvedValue(ROSTERS.slice(1))
    const res = await getManagerPresence('L-gang', KINCAID, 'me', { position: 'TE' })
    expect(res).toMatchObject({ available: false, reason: expect.stringMatching(/free agent.*claim him/) })
  })

  /* ⚠ AN ESPN ROSTER FULL OF ESPN IDS IS NOT "NOBODY HAS HIM". */
  it('refuses to call him a free agent when the rosters speak another id vocabulary', async () => {
    mockLeagueFindUnique.mockResolvedValue({ ...LEAGUE, platform: 'espn' })
    mockRosterFindMany.mockResolvedValue([
      { platformUserId: 'sl-tasha', playerData: { players: ['e1', 'e2', 'e3'], starters: ['e1'] } },
      { platformUserId: 'sl-me', playerData: { players: ['e4', 'e5'], starters: ['e4'] } },
    ])
    const res = await getManagerPresence('L-gang', KINCAID, 'me', { position: 'TE' })
    expect(res.available).toBe(false)
    if (res.available) return
    expect(res.reason).toMatch(/ESPN/i)
    expect(res.reason).not.toMatch(/free agent/)
  })

  it('needs a signed-in viewer', async () => {
    expect(await getManagerPresence('L-gang', KINCAID, null)).toEqual({ available: false, reason: 'sign in to see who to pitch' })
    expect(mockLeagueFindUnique).not.toHaveBeenCalled()
  })
})

describe('getManagerPresence — a platform whose moves are not ingested', () => {
  it('still names the owner, need and record, and says the window is missing', async () => {
    mockLeagueFindUnique.mockResolvedValue({ ...LEAGUE, platform: 'yahoo', timezone: null })
    mockActivityFindMany.mockResolvedValue([])
    const res = await getManagerPresence('L-gang', KINCAID, 'me', { position: 'TE' })
    expect(res.available).toBe(true)
    if (!res.available) return
    expect(res.data).toMatchObject({ platform: 'yahoo', activityIngested: false, newestMove: null, unattributed: 0, timeZone: 'America/New_York' })
    expect(res.data.managers[0]).toMatchObject({ ownerName: 'tashaR', record: '4-2', window: null, lastMove: null, moves: 0 })
    expect(mockProfileFindMany).not.toHaveBeenCalled()
  })
})
