/**
 * 🛑 The lineup lock looked a player's kickoff up by `RedraftRosterPlayer.team`, a snapshot taken when he
 * was ADDED. Measured on production 2026-10-12: 96 rostered NFL players (1,858 roster rows, Sleeper/native
 * leagues) whose stored team is not their Sleeper row's current one — J.J. McCarthy MIN→NYG, Darius
 * Slayton NYG→IND — and 5 Sleeper now lists with no team. A traded player locked at his OLD club's
 * kickoff, so he stayed movable after his real game started. These pin the current team, end to end
 * through the enforcing PATCH.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockNextRequest } from '../helpers/createMockNextRequest'

const NOW = new Date()
const PAST = new Date(NOW.getTime() - 60 * 60 * 1000)
const FUTURE = new Date(NOW.getTime() + 24 * 60 * 60 * 1000)

const h = vi.hoisted(() => ({
  rosterPlayers: [] as Array<Record<string, unknown>>,
  sportsPlayers: [] as Array<Record<string, unknown>>,
  games: [] as Array<{ homeTeam: string; awayTeam: string; startTime: Date }>,
  platform: 'sleeper' as string | null,
  crosswalk: new Map<string, string>(),
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'user-1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftRoster: {
      findFirst: vi.fn(async () => ({
        id: 'r1',
        leagueId: 'L',
        ownerId: 'user-1',
        players: h.rosterPlayers.map((p) => ({ ...p })),
        season: { season: 2026, sport: 'NFL', currentWeek: 6, totalWeeks: 17 },
      })),
    },
    league: { findUnique: vi.fn(async () => ({ settings: {}, platform: h.platform })) },
    sportsInjury: { findMany: vi.fn(async () => []) },
    sportsGame: { findMany: vi.fn(async () => h.games) },
    sportsPlayer: { findMany: vi.fn(async () => h.sportsPlayers) },
    redraftRosterPlayer: { updateMany: vi.fn(async () => ({ count: 1 })) },
    $transaction: vi.fn(async () => []),
  },
}))
vi.mock('@/lib/core-app/rosterIdCrosswalk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core-app/rosterIdCrosswalk')>()),
  crosswalkToSleeperIds: vi.fn(async () => h.crosswalk),
}))
vi.mock('@/lib/league/league-access', () => ({ assertLeagueMember: vi.fn().mockResolvedValue({ ok: true, status: 200 }) }))
vi.mock('@/lib/redraft/redraftRosterIdentity', () => ({
  resolveRedraftRosterLookup: vi.fn(async () => ({ season: { id: 's1', leagueId: 'L' }, roster: { id: 'r1', ownerId: 'user-1' } })),
}))
vi.mock('@/lib/redraft/rosterMoveHistory', () => ({ recordRedraftRosterMoveHistory: vi.fn() }))
vi.mock('@/lib/redraft/scoringEngine', () => ({ calculateScoreFromSportConfig: vi.fn() }))
vi.mock('@/lib/nfl-data-foundation', () => ({
  getCanonicalNflPlayerContext: vi.fn(async () => null),
  getCanonicalNflPlayerByNameTeam: vi.fn(async () => null),
}))

import { PATCH } from '@/app/api/redraft/roster/route'
import { hydrateRedraftLineupLocks } from '@/lib/redraft/lineupLock'
import { resolveCurrentLockTeams } from '@/lib/redraft/lineupLockCurrentTeam'
import { prisma } from '@/lib/prisma'

const rp = (playerId: string, playerName: string, team: string, slotType = 'WR') => ({
  playerId,
  playerName,
  position: 'WR',
  team,
  sport: 'NFL',
  slotType,
  isLocked: false,
  injuryStatus: null,
  byeWeek: null,
})
const sleeperRow = (sleeperId: string, name: string, team: string | null) => ({
  externalId: `sleeper:${sleeperId}`,
  sleeperId,
  name,
  position: 'WR',
  team,
  source: 'sleeper',
  fetchedAt: NOW,
})

beforeEach(() => {
  h.platform = 'sleeper'
  h.crosswalk = new Map()
  // MIA's game has kicked off; WAS plays tomorrow.
  h.games = [
    { homeTeam: 'MIA', awayTeam: 'BUF', startTime: PAST },
    { homeTeam: 'WAS', awayTeam: 'DAL', startTime: FUTURE },
  ]
  h.rosterPlayers = [rp('100', 'Traded To Miami', 'WAS'), rp('200', 'Released', 'BUF'), rp('300', 'Unknown To Sleeper', 'MIA')]
  // Sleeper's NFL rows carry FULL names (all 3,452 with a team, 2026-10-12).
  h.sportsPlayers = [sleeperRow('100', 'Traded To Miami', 'Miami Dolphins'), sleeperRow('200', 'Released', null)]
})

async function patchMoves(playerIds: string[]) {
  const res = await PATCH(
    createMockNextRequest('http://localhost/api/redraft/roster', {
      method: 'PATCH',
      body: { rosterId: 'r1', week: 6, moves: playerIds.map((playerId) => ({ playerId, toSlot: 'BN' })) },
    }),
  )
  const body = (await res.json()) as { validation?: { issues?: Array<{ code: string; playerId?: string }> } }
  return (body.validation?.issues ?? []).filter((i) => i.code === 'locked_player_move').map((i) => i.playerId)
}

describe('lineup lock reads the CURRENT team, not the stored snapshot', () => {
  it('🛑 PATCH refuses to move a traded player whose NEW club has kicked off (stored team plays tomorrow)', async () => {
    expect(await patchMoves(['100'])).toEqual(['100'])
  })

  it('a player Sleeper lists with no team is not locked by his stale club', async () => {
    expect(await patchMoves(['200'])).toEqual([])
  })

  it('no Sleeper row: the stored team still locks him', async () => {
    expect(await patchMoves(['300'])).toEqual(['300'])
  })

  it('a read failure falls back to the stored team, never to "no team"', async () => {
    vi.mocked(prisma.sportsPlayer.findMany).mockRejectedValueOnce(new Error('db down'))
    // Stored WAS has not kicked off; stored MIA has — exactly the pre-fix behaviour, not an unlock.
    expect(await patchMoves(['100', '300'])).toEqual(['300'])
  })
})

describe('resolveCurrentLockTeams', () => {
  it('folds Sleeper full names to the abbreviation the kickoff map is keyed by; null for no club', async () => {
    const teams = await resolveCurrentLockTeams(prisma as never, { sport: 'NFL', platform: 'sleeper', playerIds: ['100', '200', '300'] })
    expect([...teams]).toEqual([
      ['100', 'MIA'],
      ['200', null],
    ])
  })

  it('a vendor row never speaks for the team — it holds a free agent\'s LAST club', async () => {
    h.sportsPlayers = [{ ...sleeperRow('200', 'Released', 'Buffalo Bills'), source: 'thesportsdb', externalId: 'tsdb_1' }]
    const teams = await resolveCurrentLockTeams(prisma as never, { sport: 'NFL', platform: 'sleeper', playerIds: ['200'] })
    expect(teams.has('200')).toBe(false)
  })

  it('translates a foreign roster id through the crosswalk; an unmapped one is left on its stored team', async () => {
    h.platform = 'espn'
    h.crosswalk = new Map([['4430', '100']])
    // ESPN '200' is unmapped: it must NOT be read as Sleeper's '200'.
    const teams = await resolveCurrentLockTeams(prisma as never, { sport: 'NFL', platform: 'espn', playerIds: ['4430', '200'] })
    expect([...teams]).toEqual([['4430', 'MIA']])
  })

  it('is NFL only', async () => {
    const teams = await resolveCurrentLockTeams(prisma as never, { sport: 'NHL', platform: 'sleeper', playerIds: ['100'] })
    expect(teams.size).toBe(0)
  })
})

describe('hydrateRedraftLineupLocks — currentTeamByPlayerId is used for the kickoff only', () => {
  it('locks on the current team and leaves the returned team untouched', async () => {
    const { players } = await hydrateRedraftLineupLocks(prisma as never, {
      sport: 'NFL',
      season: 2026,
      week: 6,
      rosterId: 'r1',
      leagueSettings: {},
      now: NOW,
      players: [
        { playerId: '100', team: 'WAS' },
        { playerId: '200', team: 'BUF' },
      ],
      currentTeamByPlayerId: new Map<string, string | null>([
        ['100', 'MIA'],
        ['200', null],
      ]),
    })
    expect(players.map((p) => [p.playerId, p.team, p.isLocked])).toEqual([
      ['100', 'WAS', true],
      ['200', 'BUF', false],
    ])
  })
})
