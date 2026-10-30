// @vitest-environment node
/**
 * The public standings table published records read straight off `WeeklyMatchup.win`. That column is
 * not a result (see standingsModel.ts): a tie is stored as `win = 0` for both sides, so the public
 * table printed every tie as a LOSS; a roster with no opponent that scored is stored as `win = 1`, so
 * an unpaired league published every team 1-0; and the median game Sleeper counts in its own record
 * was missing altogether.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  settings: { publicStandings: true } as Record<string, unknown>,
  rows: [] as Array<Record<string, unknown>>,
  teams: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: {
      findUnique: vi.fn(async () => ({ name: 'Public League', settings: h.settings, platformLeagueId: 'sl-9', lastSyncedAt: null })),
    },
    weeklyMatchup: { findMany: vi.fn(async () => h.rows) },
    leagueTeam: { findMany: vi.fn(async () => h.teams) },
  },
}))
vi.mock('@/lib/core-app/leagueHome', () => ({ leagueDisplayName: (n: string | null) => n ?? 'League' }))

const { getPublicLeagueStandings } = await import('@/lib/core-app/publicStandings')

type Game = [week: number, matchupId: number | null, rosterId: string, pf: number, pa: number]
/** `win` exactly as the Sleeper writer stored it before the fix: points above the (maybe phantom) opponent. */
const row = ([week, matchupId, rosterId, pf, pa]: Game) => ({
  seasonYear: 2026,
  week,
  rosterId,
  matchupId,
  pointsFor: pf,
  pointsAgainst: pa,
  win: pf > pa ? 1 : 0,
})

function pairedSeason() {
  const games: Game[] = [
    [1, 1, '1', 120, 100],
    [1, 1, '2', 100, 120],
    [1, 2, '3', 90, 90],
    [1, 2, '4', 90, 90],
    [2, 1, '1', 70, 110],
    [2, 1, '3', 110, 70],
    [2, 2, '2', 101, 95],
    [2, 2, '4', 95, 101],
    // Week 3 is the unplayed schedule ahead.
    [3, 1, '1', 0, 0],
    [3, 1, '4', 0, 0],
    [3, 2, '2', 0, 0],
    [3, 2, '3', 0, 0],
  ]
  h.rows = games.map(row)
}

const record = (data: Awaited<ReturnType<typeof getPublicLeagueStandings>>, name: string) => {
  const t = data!.teams.find((x) => x.name === name)!
  return { wins: t.wins, losses: t.losses, ties: t.ties }
}

beforeEach(() => {
  h.settings = { publicStandings: true }
  h.teams = ['1', '2', '3', '4'].map((id) => ({ externalId: id, teamName: `Team ${id}` }))
  pairedSeason()
})

describe('getPublicLeagueStandings — records', () => {
  it('publishes a tie as a tie, not as a loss', async () => {
    const data = await getPublicLeagueStandings('L9')
    expect(record(data, 'Team 3')).toEqual({ wins: 1, losses: 0, ties: 1 })
    expect(record(data, 'Team 4')).toEqual({ wins: 0, losses: 1, ties: 1 })
    expect(record(data, 'Team 1')).toEqual({ wins: 1, losses: 1, ties: 0 })
  })

  it('keeps the documented order: points for, most first', async () => {
    const data = await getPublicLeagueStandings('L9')
    expect(data!.teams.map((t) => t.name)).toEqual(['Team 2', 'Team 3', 'Team 1', 'Team 4'])
    expect(data!.teams.map((t) => t.rank)).toEqual([1, 2, 3, 4])
  })

  it('publishes no result for a roster that had no opponent', async () => {
    // A league with no head-to-head pairing: every roster sits alone in its own matchup.
    h.rows = ([
      [1, 1, '1', 120, 0],
      [1, 2, '2', 100, 0],
      [1, 3, '3', 90, 0],
      [1, 4, '4', 80, 0],
    ] as Game[]).map(row)
    const data = await getPublicLeagueStandings('L9')
    for (const t of data!.teams) expect({ wins: t.wins, losses: t.losses, ties: t.ties }).toEqual({ wins: 0, losses: 0, ties: 0 })
  })

  it("counts Sleeper's median game when the league plays one", async () => {
    h.settings = { publicStandings: true, league_average_match: 1 }
    const data = await getPublicLeagueStandings('L9')
    // Week 1 top half: 1, 2. Week 2 top half: 3, 2.
    expect(record(data, 'Team 1')).toEqual({ wins: 2, losses: 2, ties: 0 })
    expect(record(data, 'Team 2')).toEqual({ wins: 3, losses: 1, ties: 0 })
    expect(record(data, 'Team 3')).toEqual({ wins: 2, losses: 1, ties: 1 })
    expect(record(data, 'Team 4')).toEqual({ wins: 0, losses: 3, ties: 1 })
  })

  it('plays no median game in a playoff week', async () => {
    h.settings = { publicStandings: true, league_average_match: 1, playoff_week_start: 2 }
    const data = await getPublicLeagueStandings('L9')
    // Week 2 is the first playoff week: its head-to-head result stands, its median does not exist.
    expect(record(data, 'Team 1')).toEqual({ wins: 2, losses: 1, ties: 0 })
    expect(record(data, 'Team 3')).toEqual({ wins: 1, losses: 1, ties: 1 })
  })

  it('infers the median game from platform records when the settings are silent', async () => {
    h.teams = h.teams.map((t) => ({ ...t, wins: 2, losses: 2, ties: 0 }))
    const data = await getPublicLeagueStandings('L9')
    expect(record(data, 'Team 2')).toEqual({ wins: 3, losses: 1, ties: 0 })
  })
})
