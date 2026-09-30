// @vitest-environment node
/**
 * 🛑 A COLLEGE STARTER ON A FANTRAX ROSTER GETS HIS GAME.
 *
 * Measured on production 2026-09-30: the only college league is on Fantrax (12 rosters, 465
 * Fantrax ids, none of them Sleeper ids), and My Team's Fantrax branch built every player with
 * `gameContext: null, kickoff: null`. No opponent, no kickoff, no lineup lock.
 *
 * Drives the REAL `getMyTeamData` over a permissive prisma double, the same harness as
 * my-team-foreign-roster-ids. Only the Fantrax player resolver and the college directory are
 * stubbed, with the shapes they return in production (a CFBD school name, or a Fantrax code).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildCollegeTeamIndex } from '@/lib/sport-teams/collegeTeamIdentity'

const db = vi.hoisted(() => ({
  answers: {} as Record<string, (args: any) => unknown>,
  sport: 'NCAAF',
}))

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

vi.mock('@/lib/core-app/currentWeek', () => ({
  resolveCurrentWeekForLeague: vi.fn(async () => ({ seasonYear: 2026, week: 6 })),
}))
vi.mock('@/lib/core-app/sportsWeek', () => ({
  resolveSportsWeek: vi.fn(async () => ({ season: 2026, week: 6, seasonType: 'regular' })),
  isPreseason: (t: string | null | undefined) => (t ?? '').toLowerCase().startsWith('pre'),
  isRegularSeason: (t: string | null | undefined) => (t ?? '').toLowerCase().startsWith('reg'),
}))

// Fantrax ids → players as `connectedRosterPlayers` returns them in production.
vi.mock('@/lib/core-app/connectedRoster', () => ({
  connectedRosterPlayers: vi.fn(async () => [
    { id: '06k5m', name: 'Badger Back', position: 'RB', team: 'Wisconsin', imageUrl: null, logoUrl: null },
    { id: '07abc', name: 'Code Receiver', position: 'WR', team: 'wisc', imageUrl: null, logoUrl: null },
    { id: '08xyz', name: 'Knight Passer', position: 'QB', team: 'Rutgers', imageUrl: null, logoUrl: null },
  ]),
}))

vi.mock('@/lib/sport-teams/collegeTeamIndexStore', () => ({
  loadCollegeTeamIndex: vi.fn(async () =>
    buildCollegeTeamIndex([
      { id: 275, school: 'Wisconsin', mascot: 'Badgers', abbreviation: 'WIS' },
      { id: 164, school: 'Rutgers', mascot: 'Scarlet Knights', abbreviation: 'RUTG' },
    ]),
  ),
}))

const LEAGUE_ID = 'league-cfb'
const USER_ID = 'af-user-1'
const KICKOFF = new Date('2026-10-03T19:30:00Z')
const FANTRAX_IDS = ['06k5m', '07abc', '08xyz']

function answerDb() {
  db.answers = {
    'leagueTeam.findMany': () => [
      { externalId: '4', teamName: 'Mine', ownerName: 'me', avatarUrl: null, platformUserId: 'fu4', claimedByUserId: USER_ID },
    ],
    'roster.findFirst': () => ({ playerData: { players: FANTRAX_IDS, starters: FANTRAX_IDS } }),
    'roster.findMany': () => [{ id: 'r4', platformUserId: 'fu4', playerData: { starters: FANTRAX_IDS } }],
    // The week's college slate, spelled the way two different feeds spell it.
    'sportsGame.findMany': (args) =>
      args?.where?.sport === 'NCAAF'
        ? [
            { homeTeam: 'Wisconsin Badgers', awayTeam: 'Rutgers Scarlet Knights', startTime: KICKOFF, seasonType: 'regular', venue: 'Camp Randall Stadium' },
            { homeTeam: 'Wisconsin', awayTeam: 'Rutgers', startTime: KICKOFF, seasonType: 'regular', venue: null },
          ]
        : [],
  }
}

function context() {
  return {
    leagueId: LEAGUE_ID,
    userId: USER_ID,
    league: vi.fn(async () => ({
      id: LEAGUE_ID,
      name: 'CFB League',
      platform: 'fantrax',
      platformLeagueId: 'fx1',
      sport: db.sport,
      season: 2026,
      leagueType: 'redraft',
      isDynasty: false,
      starters: null,
      settings: { scoring_settings: { rec: 1 }, roster_positions: ['QB', 'RB', 'WR', 'BN'] },
    })),
    claimedTeam: vi.fn(async () => ({
      id: 'lt-4', externalId: '4', platformUserId: 'fu4', teamName: 'Mine', ownerName: 'me', avatarUrl: null,
      wins: 1, losses: 1, ties: 0, pointsFor: 200, pointsAgainst: 190, currentRank: 5,
    })),
    claimedTeams: vi.fn(async () => []),
  }
}

async function starters() {
  const { getMyTeamData } = await import('@/lib/core-app/myTeam')
  const data = await getMyTeamData(LEAGUE_ID, USER_ID, context() as any)
  if (!data) throw new Error('no My Team data')
  if (!data.starters.available) throw new Error(`no starters: ${data.starters.reason}`)
  return data.starters.data.map((s) => s.player).filter(Boolean) as Array<{
    name: string
    gameContext: string | null
    kickoff: Date | string | null
    venue: string | null
  }>
}

describe('My Team — college starters on a Fantrax roster', () => {
  beforeAll(async () => {
    await import('@/lib/core-app/myTeam')
  }, 180_000)

  beforeEach(() => {
    db.sport = 'NCAAF'
    answerDb()
  })

  it('control: the Fantrax players are named at all', async () => {
    const names = (await starters()).map((p) => p.name)
    expect(names).toEqual(expect.arrayContaining(['Badger Back', 'Code Receiver', 'Knight Passer']))
  })

  it('🛑 each starter gets opponent, kickoff and venue from the week’s college slate', async () => {
    const byName = new Map((await starters()).map((p) => [p.name, p]))
    const home = byName.get('Badger Back')!
    expect(home.gameContext).toMatch(/^Wisconsin vs Rutgers/)
    expect(new Date(home.kickoff as string).toISOString()).toBe(KICKOFF.toISOString())
    expect(home.venue).toBe('Camp Randall Stadium')
    // A Fantrax code reaches the same fixture as the school name.
    expect(byName.get('Code Receiver')!.gameContext).toMatch(/^Wisconsin vs Rutgers/)
    expect(byName.get('Knight Passer')!.gameContext).toMatch(/^Rutgers @ Wisconsin/)
  })
})
