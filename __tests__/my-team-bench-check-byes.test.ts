// @vitest-environment node
/**
 * 🛑 THE BENCH CHECK SEES BYES.
 *
 * `getMyTeamData` ran the bench check before the bye pass, so every player still read
 * `onBye: false` when it was asked who should start. Two failures, both of which are the exact
 * mistake the check exists to catch:
 *   · a bench player on bye was recommended over a starter who is playing;
 *   · a starter on bye kept his feed projection, so a playing bench player who projects lower than
 *     that stale number was never suggested — the manager was left starting a guaranteed zero.
 *
 * Drives the REAL `getMyTeamData` (resolver, bye pass, bench check) over a prisma double with one
 * club off this week and an otherwise complete slate, which is what `getByeWeeks` requires before
 * it will call anything a bye.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  answers: {} as Record<string, (args: any) => unknown>,
}))

/** Permissive double: every model and method answers; unlisted reads get an empty-but-valid value. */
vi.mock('@/lib/prisma', () => {
  const fallback = (method: string) =>
    method === 'count' ? 0 : method === 'findMany' || method.startsWith('$query') ? [] : null
  const modelProxy = (model: string) =>
    new Proxy(
      {},
      {
        get: (_t, method: string) =>
          vi.fn(async (args: unknown) => {
            const answer = db.answers[`${model}.${method}`]
            return answer ? answer(args) : fallback(method)
          }),
      },
    )
  const prisma = new Proxy(
    {},
    {
      get: (_t, key: string) => {
        if (key.startsWith('$query') || key.startsWith('$execute')) return vi.fn(async () => [])
        if (key === '$transaction') return vi.fn(async (ops: unknown) => (Array.isArray(ops) ? Promise.all(ops) : null))
        if (key === 'then') return undefined
        return modelProxy(key)
      },
    },
  )
  return { prisma, default: prisma }
})

const STARTERS = ['qb1', 'wrStart']
const BENCH = ['wrBench']

vi.mock('@/lib/core-app/currentSleeperRoster', () => ({
  currentSleeperRoster: vi.fn(async () => ({
    players: [...STARTERS, ...BENCH],
    starters: [...STARTERS],
    reserve: [],
    taxi: [],
    verification: { checkedAt: '2026-09-25T12:00:00.000Z', source: 'Sleeper', week: 3, slots: ['QB', 'WR'] },
  })),
}))

vi.mock('@/lib/core-app/currentWeek', () => ({
  resolveCurrentWeekForLeague: vi.fn(async () => ({ seasonYear: 2026, week: 3 })),
}))

vi.mock('@/lib/core-app/sportsWeek', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core-app/sportsWeek')>()),
  resolveSportsWeek: vi.fn(async () => ({ season: 2026, week: 3, seasonType: 'regular' })),
}))

const LEAGUE_ID = 'league-bye'
const USER_ID = 'af-user-1'

/** The club off in week 3. Every other club listed plays. */
const BYE_CLUB = 'BUF'
const PLAYING = ['NYJ', 'MIA', 'NE', 'KC', 'LV', 'LAC', 'DEN', 'DAL', 'PHI', 'NYG', 'WAS', 'GB', 'CHI', 'DET', 'MIN', 'SF', 'SEA', 'LAR', 'ARI', 'TB', 'NO', 'ATL', 'CAR', 'PIT', 'BAL', 'CLE']

/** Catches projected this week; the league scores a point a catch, so this IS each player's number. */
const state = vi.hoisted(() => ({
  receptions: {} as Record<string, number>,
  club: {} as Record<string, string>,
  position: {} as Record<string, string>,
}))
const nameOf = (id: string) => `Player ${id}`

function answerDb() {
  db.answers = {
    'fantasyProjection.findFirst': () => ({ season: '2026', week: 3 }),
    'fantasyProjection.findMany': (args) =>
      (args?.where?.playerId?.in ?? [])
        .filter((id: string) => id in state.receptions)
        .map((id: string) => ({
          playerId: id,
          projectedPoints: state.receptions[id],
          stats: { name: nameOf(id), position: state.position[id], team: state.club[id], stats: { rec: state.receptions[id] } },
        })),
    'sportsPlayer.findMany': (args) =>
      (args?.where?.sleeperId?.in ?? [])
        .filter((id: string) => id in state.club)
        .map((id: string) => ({ sleeperId: id, name: nameOf(id), position: state.position[id], team: state.club[id], sport: 'NFL', imageUrl: null })),
    // Thirteen distinct fixtures in week 3 — a plausible full slate — and none involves BUF.
    'sportsGame.findMany': () =>
      Array.from({ length: PLAYING.length / 2 }, (_, i) => ({
        homeTeam: PLAYING[2 * i],
        awayTeam: PLAYING[2 * i + 1],
        week: 3,
        seasonType: 'regular',
      })),
  }
}

function context() {
  return {
    leagueId: LEAGUE_ID,
    userId: USER_ID,
    league: vi.fn(async () => ({
      id: LEAGUE_ID,
      name: 'Bye League',
      platform: 'sleeper',
      platformLeagueId: '999',
      sport: 'NFL',
      season: 2026,
      leagueType: 'redraft',
      isDynasty: false,
      starters: null,
      settings: { scoring_settings: { rec: 1 }, roster_positions: ['QB', 'WR', 'BN'] },
    })),
    claimedTeam: vi.fn(async () => ({
      id: 'lt-4', externalId: '4', platformUserId: 'su4', teamName: 'Mine', ownerName: 'me', avatarUrl: null,
      wins: 1, losses: 1, ties: 0, pointsFor: 200, pointsAgainst: 190, currentRank: 5,
    })),
    claimedTeams: vi.fn(async () => []),
  }
}

async function wrSlot() {
  const { getMyTeamData } = await import('@/lib/core-app/myTeam')
  const data = await getMyTeamData(LEAGUE_ID, USER_ID, context() as any)
  if (!data?.starters.available) throw new Error('no starters')
  const slot = data.starters.data.find((s) => s.player?.sleeperId === 'wrStart')
  if (!slot) throw new Error('no WR slot')
  return slot
}

describe('My Team — the bench check sees byes', () => {
  beforeAll(async () => {
    await import('@/lib/core-app/myTeam')
  }, 180_000)

  beforeEach(() => {
    state.receptions = { qb1: 20, wrStart: 12, wrBench: 25 }
    state.club = { qb1: 'NYJ', wrStart: 'MIA', wrBench: 'NE' }
    state.position = { qb1: 'QB', wrStart: 'WR', wrBench: 'WR' }
    answerDb()
  })

  it('control: with nobody on bye, the stronger bench receiver is suggested', async () => {
    const slot = await wrSlot()
    expect(slot.benchCheck?.benchName).toBe(nameOf('wrBench'))
    expect(slot.benchCheck?.verdict).toBe('swap')
  })

  it('🛑 never suggests a bench player whose club is off this week', async () => {
    state.club.wrBench = BYE_CLUB
    const slot = await wrSlot()
    expect(slot.benchCheck).toBeNull()
  })

  it('🛑 a starter on bye is a 0, so any playing, eligible bench player beats him', async () => {
    state.club.wrStart = BYE_CLUB
    state.receptions.wrBench = 5 // below the starter's stale 12 — only the bye makes this a swap
    const slot = await wrSlot()
    expect(slot.player?.onBye).toBe(true)
    expect(slot.benchCheck).toEqual({
      verdict: 'swap',
      benchName: nameOf('wrBench'),
      benchProjected: 5,
      starterName: nameOf('wrStart'),
      starterProjected: 0,
    })
  })
})
