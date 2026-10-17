// @vitest-environment node
/**
 * 🛑 MY TEAM NEVER NAMES A STRANGER FROM A FOREIGN-ID ROSTER.
 *
 * A Fleaflicker/MFL/Fantrax/Yahoo roster holds the provider's own ids — short numbers in Sleeper's
 * range; 44 of the 248 on the one production Fleaflicker league ARE real Sleeper ids (2026-09-27).
 * `resolvePlayers` crosswalked what it could and then fell back to the RAW id (`?? id`), so a
 * colliding id rendered as another player: his name, team, headshot, injury, projection.
 *
 * Drives the REAL `getMyTeamData` over a permissive prisma double. The stored roster's ids are all
 * real Sleeper ids in the double; under a MANUAL league (Sleeper id space, same DB read path) they
 * resolve by name — the control proving the harness can see names at all — and under FLEAFLICKER
 * not one of them may.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  answers: {} as Record<string, (args: any) => unknown>,
  platform: 'fleaflicker',
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
  resolveCurrentWeekForLeague: vi.fn(async () => ({ seasonYear: 2026, week: 3 })),
}))
vi.mock('@/lib/core-app/sportsWeek', () => ({
  resolveSportsWeek: vi.fn(async () => ({ season: 2026, week: 3, seasonType: 'regular' })),
}))

const LEAGUE_ID = 'league-flea'
const USER_ID = 'af-user-1'
/** Real Sleeper ids in this double — and, on the Fleaflicker roster, Fleaflicker ids that collide. */
const SLEEPER_IDS = ['qb1', 'rb1', 'wr1', 'bench1']
const nameOf = (id: string) => `Player ${id}`

function answerDb() {
  db.answers = {
    'fantasyProjection.findFirst': () => ({ season: '2026', week: 3 }),
    'sportsPlayer.findMany': (args) =>
      (args?.where?.sleeperId?.in ?? [])
        .filter((id: string) => SLEEPER_IDS.includes(id))
        .map((id: string) => ({ sleeperId: id, name: nameOf(id), position: 'WR', team: 'NYJ', sport: 'NFL', imageUrl: null })),
    'leagueTeam.findMany': () => [
      { externalId: '4', teamName: 'Mine', ownerName: 'me', avatarUrl: null, platformUserId: 'fu4', claimedByUserId: USER_ID },
    ],
    'roster.findFirst': () => ({ playerData: { players: SLEEPER_IDS, starters: ['qb1', 'rb1', 'wr1'] } }),
    'roster.findMany': () => [{ id: 'r4', platformUserId: 'fu4', playerData: { starters: ['qb1', 'rb1', 'wr1'] } }],
  }
}

function context() {
  return {
    leagueId: LEAGUE_ID,
    userId: USER_ID,
    league: vi.fn(async () => ({
      id: LEAGUE_ID,
      name: 'Flea League',
      platform: db.platform,
      platformLeagueId: 'f1',
      sport: 'NFL',
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

async function namesShown(): Promise<string[]> {
  const { getMyTeamData } = await import('@/lib/core-app/myTeam')
  const data = await getMyTeamData(LEAGUE_ID, USER_ID, context() as any)
  if (!data) throw new Error('no My Team data')
  if (!data.starters.available) throw new Error(`no starters: ${data.starters.reason}`)
  return data.starters.data.map((s) => s.player?.name ?? '').filter(Boolean)
}

describe('My Team — a foreign-id roster', () => {
  beforeAll(async () => {
    await import('@/lib/core-app/myTeam')
  }, 180_000)

  beforeEach(() => answerDb())

  it('control: in a MANUAL league the same ids ARE Sleeper ids and are named', async () => {
    db.platform = 'manual'
    expect(await namesShown()).toEqual(expect.arrayContaining([nameOf('qb1'), nameOf('rb1'), nameOf('wr1')]))
  })

  it('🛑 in a FLEAFLICKER league not one colliding id is named as the Sleeper player sharing its number', async () => {
    db.platform = 'fleaflicker'
    const shown = await namesShown()
    for (const id of SLEEPER_IDS) expect(shown).not.toContain(nameOf(id))
  })
})
