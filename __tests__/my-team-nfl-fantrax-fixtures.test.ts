// @vitest-environment node
/**
 * 🛑 AN NFL STARTER ON A FANTRAX ROSTER GETS HIS GAME.
 *
 * Production 2026-11-21: every starter of a Fantrax NFL team read "no game found for this week" and the
 * lock read "no week 11 game found for any of your starters yet", while /core/matchup showed the same
 * players' kickoffs. My Team translated roster ids through the shared crosswalk, which has no Fantrax
 * entry, so no Fantrax id reached the Sleeper-keyed fixture join.
 *
 * Drives the REAL `getMyTeamData` over a permissive prisma double, the same harness as
 * my-team-college-fantrax-fixtures. The registry bridge (`PlayerIdentityMap.fantraxId`) is real code
 * reading the double; only the Fantrax player resolver is stubbed.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ answers: {} as Record<string, (args: any) => unknown> }))

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
  resolveCurrentWeekForLeague: vi.fn(async () => ({ seasonYear: 2026, week: 11 })),
}))
vi.mock('@/lib/core-app/sportsWeek', () => ({
  resolveSportsWeek: vi.fn(async () => ({ season: 2026, week: 11, seasonType: 'regular' })),
  isPreseason: (t: string | null | undefined) => (t ?? '').toLowerCase().startsWith('pre'),
  isRegularSeason: (t: string | null | undefined) => (t ?? '').toLowerCase().startsWith('reg'),
}))

// Fantrax ids → players as `connectedRosterPlayers` returns them: two the registry links, one it does not hold.
vi.mock('@/lib/core-app/connectedRoster', () => ({
  connectedRosterPlayers: vi.fn(async () => [
    { id: '04abc', name: 'Linked Passer', position: 'QB', team: 'KC', imageUrl: 'https://img.test/passer.png', logoUrl: null },
    { id: '05def', name: 'Linked Back', position: 'RB', team: 'NYJ', imageUrl: null, logoUrl: null },
    { id: '06aqz', name: 'Snapshot Safety', position: 'S', team: null, imageUrl: null, logoUrl: null },
  ]),
}))

const LEAGUE_ID = 'league-nfl-fx'
const USER_ID = 'af-user-1'
const KC_KICKOFF = new Date('2026-11-22T18:00:00Z')
const NYJ_KICKOFF = new Date('2026-11-22T21:05:00Z')
const FANTRAX_IDS = ['04abc', '05def', '06aqz']
const sleeperIdsAsked: string[][] = []

function answerDb() {
  sleeperIdsAsked.length = 0
  db.answers = {
    'leagueTeam.findMany': () => [
      { externalId: '4', teamName: 'Mine', ownerName: 'me', avatarUrl: null, platformUserId: 'fu4', claimedByUserId: USER_ID },
    ],
    'roster.findFirst': () => ({ playerData: { players: FANTRAX_IDS, starters: FANTRAX_IDS } }),
    'roster.findMany': () => [{ id: 'r4', platformUserId: 'fu4', playerData: { starters: FANTRAX_IDS } }],
    // The registry bridge: two Fantrax ids sit beside a Sleeper id; `06aqz` is in no row.
    'playerIdentityMap.findMany': (args) => {
      const asked: string[] = args?.where?.fantraxId?.in ?? []
      return [
        { fantraxId: '04abc', canonicalName: 'Linked Passer', position: 'QB', currentTeam: 'KC', rollingInsightsId: null, cfbdId: null, sleeperId: '4046' },
        { fantraxId: '05def', canonicalName: 'Linked Back', position: 'RB', currentTeam: 'NYJ', rollingInsightsId: null, cfbdId: null, sleeperId: '8155' },
      ].filter((row) => asked.includes(row.fantraxId))
    },
    'sportsPlayer.findMany': (args) => {
      const asked: string[] = args?.where?.sleeperId?.in ?? []
      if (asked.length) sleeperIdsAsked.push(asked)
      return [
        { sleeperId: '4046', name: 'Linked Passer', position: 'QB', team: 'KC', sport: 'NFL', imageUrl: null, source: 'sleeper', fetchedAt: new Date('2026-11-20T00:00:00Z') },
        { sleeperId: '8155', name: 'Linked Back', position: 'RB', team: 'New York Jets', sport: 'NFL', imageUrl: null, source: 'espn', fetchedAt: new Date('2026-11-20T00:00:00Z') },
      ].filter((row) => asked.includes(row.sleeperId))
    },
    'sportsGame.findMany': (args) =>
      args?.where?.sport === 'NFL' && args?.where?.week === 11
        ? [
            { homeTeam: 'Kansas City Chiefs', awayTeam: 'Arizona Cardinals', startTime: KC_KICKOFF, seasonType: 'regular', venue: 'Arrowhead Stadium', fetchedAt: null },
            { homeTeam: 'LAC', awayTeam: 'NYJ', startTime: NYJ_KICKOFF, seasonType: 'regular', venue: null, fetchedAt: null },
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
      name: 'NFL Fantrax League',
      platform: 'fantrax',
      platformLeagueId: 'fx-snapshot-1',
      sport: 'NFL',
      season: 2026,
      leagueType: 'dynasty',
      isDynasty: true,
      starters: null,
      settings: { scoring_settings: { rec: 1 }, roster_positions: ['QB', 'RB', 'DB', 'BN'] },
    })),
    claimedTeam: vi.fn(async () => ({
      id: 'lt-4', externalId: '4', platformUserId: 'fu4', teamName: 'Mine', ownerName: 'me', avatarUrl: null,
      wins: 1, losses: 1, ties: 0, pointsFor: 200, pointsAgainst: 190, currentRank: 5,
    })),
    claimedTeams: vi.fn(async () => []),
  }
}

async function load() {
  const { getMyTeamData } = await import('@/lib/core-app/myTeam')
  const data = await getMyTeamData(LEAGUE_ID, USER_ID, context() as any)
  if (!data) throw new Error('no My Team data')
  if (!data.starters.available) throw new Error(`no starters: ${data.starters.reason}`)
  const players = data.starters.data.map((s) => s.player).filter(Boolean) as Array<{
    name: string
    sleeperId: string
    gameContext: string | null
    kickoff: Date | string | null
    venue: string | null
    imageUrl: string | null
  }>
  return { data, byName: new Map(players.map((p) => [p.name, p])) }
}

describe('My Team — NFL starters on a Fantrax roster', () => {
  beforeAll(async () => {
    await import('@/lib/core-app/myTeam')
  }, 180_000)

  beforeEach(() => answerDb())

  it('control: all three Fantrax players are named', async () => {
    const { byName } = await load()
    expect([...byName.keys()]).toEqual(expect.arrayContaining(['Linked Passer', 'Linked Back', 'Snapshot Safety']))
  })

  it('🛑 a starter the registry links gets opponent, kickoff and venue from the week’s NFL slate', async () => {
    const { byName, data } = await load()
    // The Sleeper-keyed player read was asked for the translated ids.
    expect(sleeperIdsAsked.flat()).toEqual(expect.arrayContaining(['4046', '8155']))

    const passer = byName.get('Linked Passer')!
    expect(passer.gameContext).toMatch(/^KC vs ARI/)
    expect(new Date(passer.kickoff as string).toISOString()).toBe(KC_KICKOFF.toISOString())
    expect(passer.venue).toBe('Arrowhead Stadium')
    // The Fantrax read still supplies the headshot.
    expect(passer.imageUrl).toBe('https://img.test/passer.png')

    // A club the feed spells out in full reaches the same fixture.
    const back = byName.get('Linked Back')!
    expect(back.gameContext).toMatch(/^NYJ @ LAC/)
    expect(new Date(back.kickoff as string).toISOString()).toBe(NYJ_KICKOFF.toISOString())

    // So the lineup has a lock time to count down to.
    expect(data.lock.available).toBe(true)
  })

  it('a starter the registry does not hold stays named, with no game invented for him', async () => {
    const { byName } = await load()
    const safety = byName.get('Snapshot Safety')!
    expect(safety.gameContext).toBeNull()
    expect(safety.kickoff).toBeNull()
    expect(safety.sleeperId).toBe('06aqz')
  })
})
