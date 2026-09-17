// @vitest-environment node
/**
 * Team and league art on the week board (2026-09-16).
 *
 * The "Your week" screens showed "YOU" and initials where the teams' own
 * avatars belong, because the loader never selected `LeagueTeam.avatarUrl`.
 *
 * ⚠ THE PRISMA MOCK HONOURS `select`. A mock that returns whole fixture rows
 * would hand the loader `avatarUrl` whether or not the query asked for it, and
 * the "is the column selected" test below could never fail. Projecting through
 * the real `select` is what lets it go red when the select is dropped.
 *
 * ⚠ AND THE AVATAR COLUMN IS NOT A URL ON SLEEPER. It holds a bare avatar id,
 * so the loader must go through `managerArtUrl`: a bare id expands to the
 * Sleeper CDN for Sleeper only, and is null for anyone else.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>

/** Project a row through a Prisma-style `select`, recursing into relations. */
function pick(row: Row, select: Record<string, unknown>): Row {
  const out: Row = {}
  for (const [k, v] of Object.entries(select)) {
    if (v === true) out[k] = row[k]
    else if (v && typeof v === 'object' && 'select' in (v as Row)) {
      const rel = row[k] as Row | null | undefined
      out[k] = rel ? pick(rel, (v as { select: Record<string, unknown> }).select) : rel
    }
  }
  return out
}

const matchupRows: Row[] = []
const teamRows: Row[] = []

const mocks = vi.hoisted(() => ({
  weeklyFindMany: vi.fn(),
  teamFindMany: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    weeklyMatchup: { findMany: mocks.weeklyFindMany },
    leagueTeam: { findMany: mocks.teamFindMany },
  },
}))
vi.mock('@/lib/core-app/seasonPhase', () => ({
  getFirstStatedKickoff: vi.fn(async () => null),
}))

import { getRivalryRadar, getWeekBoard } from '@/lib/core-app/weekBoard'

const CDN = 'https://sleepercdn.com/avatars/thumbs/'

function mrow(leagueId: string, rosterId: string, matchupId: number): Row {
  return {
    leagueId,
    seasonYear: 2026,
    week: 1,
    rosterId,
    matchupId,
    pointsFor: 0,
    pointsAgainst: 0,
    win: 0,
  }
}

function team(
  pid: string,
  platform: string,
  externalId: string,
  teamName: string,
  avatarUrl: string | null,
  claimedByUserId: string | null = null,
): Row {
  return {
    externalId,
    teamName,
    ownerName: `${teamName} owner`,
    avatarUrl,
    claimedByUserId,
    league: { platformLeagueId: pid, platform },
  }
}

beforeEach(() => {
  matchupRows.length = 0
  teamRows.length = 0
  matchupRows.push(
    // Sleeper league P1: you (1) v opponent (2); sideline 3 v 4.
    mrow('P1', '1', 1),
    mrow('P1', '2', 1),
    mrow('P1', '3', 2),
    mrow('P1', '4', 2),
    // ESPN league P2: you (1) v opponent (2).
    mrow('P2', '1', 1),
    mrow('P2', '2', 1),
  )
  teamRows.push(
    // Your claimed row, then an unclaimed copy of the same roster with a
    // different avatar id. The copy comes LAST on purpose: the all-teams loop
    // alone would end on it, so only the claimed-row preference yields the
    // claimed avatar — which is what makes that assertion able to fail.
    team('P1', 'sleeper', '1', 'My Sleeper Team', 'myclaimedid', 'u1'),
    team('P1', 'sleeper', '1', 'My Sleeper Team', 'unclaimedcopyid'),
    team('P1', 'sleeper', '2', 'Opponent Sleeper', 'oppid'),
    team('P1', 'sleeper', '3', 'Full Url Team', 'https://example.com/c.png'),
    team('P1', 'sleeper', '4', 'No Avatar Team', null),
    team('P2', 'espn', '1', 'My Espn Team', null, 'u1'),
    // A bare id on a non-Sleeper platform cannot be interpreted — null, not a guessed CDN.
    team('P2', 'espn', '2', 'Opponent Espn', 'bareespnid'),
  )

  mocks.weeklyFindMany.mockReset()
  mocks.teamFindMany.mockReset()
  mocks.weeklyFindMany.mockImplementation(async (args: { where: { leagueId: { in: string[] } }; select: Row }) =>
    matchupRows
      .filter((r) => args.where.leagueId.in.includes(r.leagueId as string))
      .map((r) => pick(r, args.select as Record<string, unknown>)),
  )
  mocks.teamFindMany.mockImplementation(
    async (args: {
      where: { league: { platformLeagueId: { in: string[] } }; claimedByUserId?: string }
      select: Row
    }) =>
      teamRows
        .filter((t) =>
          args.where.league.platformLeagueId.in.includes(
            (t.league as { platformLeagueId: string }).platformLeagueId,
          ),
        )
        .filter((t) => args.where.claimedByUserId == null || t.claimedByUserId === args.where.claimedByUserId)
        .map((t) => pick(t, args.select as Record<string, unknown>)),
  )
})

const LEAGUES = [
  {
    id: 'L-sl',
    name: 'Sleeper League',
    platform: 'sleeper',
    platformLeagueId: 'P1',
    logoUrl: null,
    avatarUrl: 'leagueavatarid',
    leagueType: 'redraft',
  },
  {
    id: 'L-es',
    name: 'ESPN League',
    platform: 'espn',
    platformLeagueId: 'P2',
    logoUrl: null,
    avatarUrl: 'bareleagueid',
    leagueType: 'redraft',
  },
]

describe('getWeekBoard — team avatars', () => {
  it('selects LeagueTeam.avatarUrl and the league platform on both team reads', async () => {
    await getWeekBoard('u1', LEAGUES, 'L-sl')
    expect(mocks.teamFindMany).toHaveBeenCalledTimes(2)
    for (const [args] of mocks.teamFindMany.mock.calls) {
      expect(args.select.avatarUrl).toBe(true)
      expect(args.select.league.select.platform).toBe(true)
    }
  })

  it('expands a bare Sleeper avatar id to the Sleeper CDN for the opponent, yourself and the sidelines', async () => {
    const board = await getWeekBoard('u1', LEAGUES, 'L-sl')
    const lb = board.leagueBoard!
    expect(lb).not.toBeNull()
    expect(lb.yours!.opponent).toEqual({
      rosterId: '2',
      name: 'Opponent Sleeper',
      avatarUrl: `${CDN}oppid`,
    })
    // The claimed row, not the unclaimed copy of the same roster.
    expect(lb.yourAvatarUrl).toBe(`${CDN}myclaimedid`)
    expect(lb.yourTeamName).toBe('My Sleeper Team')

    expect(lb.sidelines).toHaveLength(1)
    const sides = [lb.sidelines[0]!.a, lb.sidelines[0]!.b].sort((x, y) => x.rosterId.localeCompare(y.rosterId))
    expect(sides[0]).toMatchObject({ rosterId: '3', avatarUrl: 'https://example.com/c.png' })
    expect(sides[1]).toMatchObject({ rosterId: '4', name: 'No Avatar Team', avatarUrl: null })
  })

  it('returns null for a bare id on a non-Sleeper platform, and for a team with no avatar', async () => {
    const board = await getWeekBoard('u1', LEAGUES, 'L-es')
    const lb = board.leagueBoard!
    expect(lb.yours!.opponent.name).toBe('Opponent Espn')
    expect(lb.yours!.opponent.avatarUrl).toBeNull()
    expect(lb.yourAvatarUrl).toBeNull()
  })

  it("resolves the avatar against the team row's own league platform, not only the caller's", async () => {
    // The page passes `String(l.platform ?? '')`, so an empty platform is a real input.
    const board = await getWeekBoard(
      'u1',
      LEAGUES.map((l) => ({ ...l, platform: '' })),
      'L-sl',
    )
    expect(board.leagueBoard!.yours!.opponent.avatarUrl).toBe(`${CDN}oppid`)
  })

  it('keeps names, projections and the cross-league cards unchanged', async () => {
    const board = await getWeekBoard('u1', LEAGUES)
    expect(board.leagueBoard).toBeNull()
    const all = [...board.coinFlips, ...board.leaning, ...board.unprojected]
    expect(all.map((m) => m.leagueId).sort()).toEqual(['L-es', 'L-sl'])
    for (const m of all) {
      expect(m.projection).toBeNull()
      expect(m.href).toBe(`/core/matchup?league=${encodeURIComponent(m.leagueId)}`)
    }
  })
})

describe('getWeekBoard — league crest', () => {
  it('resolves league art through leagueArtUrl onto each matchup', async () => {
    const board = await getWeekBoard('u1', LEAGUES)
    const byId = new Map(board.unprojected.map((m) => [m.leagueId, m]))
    expect(byId.get('L-sl')!.leagueImageUrl).toBe(`${CDN}leagueavatarid`)
    // A bare id on ESPN is not a link; the crest falls back to its monogram.
    expect(byId.get('L-es')!.leagueImageUrl).toBeNull()
  })

  it('prefers a commissioner logo over the platform avatar', async () => {
    const board = await getWeekBoard('u1', [
      { ...LEAGUES[0]!, logoUrl: 'https://example.com/logo.png' },
    ])
    expect(board.unprojected[0]!.leagueImageUrl).toBe('https://example.com/logo.png')
  })
})

describe('getRivalryRadar — opponent avatar', () => {
  it('carries the resolved avatar on each rivalry card opponent', async () => {
    const radar = await getRivalryRadar('u1', LEAGUES)
    const cards = [...radar.theyOwnYou, ...radar.youOwnThem, ...radar.even]
    const sleeperCard = cards.find((c) => c.leagueId === 'L-sl')
    expect(sleeperCard?.opponent.avatarUrl).toBe(`${CDN}oppid`)
    const espnCard = cards.find((c) => c.leagueId === 'L-es')
    expect(espnCard?.opponent.avatarUrl).toBeNull()
  })
})
