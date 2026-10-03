// @vitest-environment node
/**
 * The cross-league matchup pulse's roster join.
 *
 * 🛑 THE OPPONENT'S KEY IS OFTEN ONE NOBODY CAN NAME. Since #1005 a managerless team's roster is
 * stored under `orphan-<provider>-<teamId>`, which is nobody's manager id. Production 2026-09-17:
 * 207 of the 210 teams no manager id could reach are orphans, and 60 matchups of a claimed team in 16
 * leagues face one. Every such pairing fell into `notRanked.unpriceable`, so the league disappeared
 * from this board rather than showing a projected score.
 *
 * ⚠ This board derives the orphan key rather than resolving through `resolveRostersForTeams`, and the
 * reason is cost: the full rule needs every roster of every league, because the key may be one we
 * cannot name — fine for a single-league screen, ~1.5 MB on the 96-league account this serves.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
/* The board's own cache wrapper would otherwise hold one fixture's answer across tests. */
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }))

const db = vi.hoisted(() => ({
  claimed: [] as Array<Record<string, unknown>>,
  weekRows: [] as Array<Record<string, unknown>>,
  teams: [] as Array<Record<string, unknown>>,
  rosters: [] as Array<Record<string, unknown>>,
  rosterWhere: [] as Array<Record<string, unknown>>,
  games: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    /* The slimmed settings read — one row per league, from the claimed fixture's own settings. */
    $queryRawUnsafe: vi.fn(async (_sql: string, ids: string[]) =>
      db.claimed.flatMap((c) => {
        const l = c.league as { id?: string; settings?: unknown } | undefined
        return l?.id && ids.includes(l.id) ? [{ id: l.id, settings: l.settings ?? null }] : []
      }),
    ),
    leagueTeam: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        where.claimedByUserId ? db.claimed : db.teams,
      ),
    },
    weeklyMatchup: {
      groupBy: vi.fn(async () =>
        db.weekRows.map((r) => ({
          leagueId: r.leagueId,
          seasonYear: r.seasonYear,
          week: r.week,
          _max: { pointsFor: r.pointsFor, pointsAgainst: r.pointsAgainst },
        })),
      ),
      findMany: vi.fn(async ({ where }: { where: { OR: Array<{ leagueId: string; seasonYear: number; week: number }> } }) => db.weekRows.filter((row) => where.OR.some((period) => row.leagueId === period.leagueId && row.seasonYear === period.seasonYear && row.week === period.week))),
    },
    roster: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        db.rosterWhere.push(where)
        const keys = (where.platformUserId as { in?: string[] } | undefined)?.in
        return db.rosters.filter((r) => !keys || keys.includes(String(r.platformUserId)))
      }),
    },
    /* Only the finished-week read filters by (season, week) pairs; every other schedule read gets none. */
    sportsGame: { findMany: vi.fn(async (args?: { where?: { OR?: unknown } }) => (args?.where?.OR ? db.games : [])) },
  },
}))

/* Per-player prices, so both sides can start the same NUMBER of players and still differ. */
const PRICES: Record<string, number> = { a: 10, b: 10, c: 6, d: 6 }
vi.mock('@/lib/core-app/playerProjections', () => ({
  latestProjectionWeek: vi.fn(async () => ({ season: '2026', week: 2 })),
  lookupProjections: vi.fn(async (ids: string[]) =>
    new Map(ids.filter((id) => PRICES[id] != null).map((id) => [id, { projectedPoints: PRICES[id] }])),
  ),
}))

import { getMatchupPulse } from '@/lib/core-app/matchupPulse'

const NOW = new Date('2026-09-17T12:00:00Z')
const USER = 'af-user-1'
const PLID = '99887766'

const LEAGUE = {
  id: 'L1',
  name: 'Test League',
  platform: 'sleeper',
  platformLeagueId: PLID,
  season: '2026',
  sport: 'NFL',
  logoUrl: null,
  avatarUrl: null,
  settings: { scoring_settings: { rec: 1 } },
}

beforeEach(() => {
  vi.clearAllMocks()
  db.rosterWhere = []
  db.games = []
  db.claimed = [{ externalId: '1', platformUserId: 'me-sleeper', league: LEAGUE }]
  db.weekRows = [
    { leagueId: PLID, seasonYear: 2026, week: 2, rosterId: '1', matchupId: 5, pointsFor: 0, pointsAgainst: 0 },
    { leagueId: PLID, seasonYear: 2026, week: 2, rosterId: '2', matchupId: 5, pointsFor: 0, pointsAgainst: 0 },
  ]
  db.teams = [
    { leagueId: 'L1', externalId: '1', platformUserId: 'me-sleeper', teamName: 'Mine', ownerName: 'Me', avatarUrl: null },
    /* The opponent is managerless: no manager id exists to offer. */
    { leagueId: 'L1', externalId: '2', platformUserId: null, teamName: 'Theirs', ownerName: null, avatarUrl: null },
  ]
  db.rosters = [
    { leagueId: 'L1', platformUserId: 'me-sleeper', playerData: { starters: ['a', 'b'] } },
    { leagueId: 'L1', platformUserId: 'orphan-sleeper-2', playerData: { source_team_id: '2', starters: ['c', 'd'] } },
  ]
})

describe('getMatchupPulse roster join', () => {
  it('keeps the provider’s current week while it is live instead of advancing to the next unscored week', async () => {
    db.claimed = [{ externalId: '1', platformUserId: 'me-sleeper', league: { ...LEAGUE, settings: { ...LEAGUE.settings, leg: 2 } } }]
    db.weekRows[0].pointsFor = 30
    db.weekRows[0].pointsAgainst = 20
    db.weekRows[1].pointsFor = 20
    db.weekRows[1].pointsAgainst = 30
    db.weekRows.push(...db.weekRows.map((row) => ({ ...row, week: 3, pointsFor: 0, pointsAgainst: 0 })))
    const pulse = await getMatchupPulse(USER, NOW)
    expect(pulse.leading[0]).toMatchObject({ week: 2, basis: 'scored', margin: 10 })
  })
  it('🛑 prices a matchup whose opponent is an orphan team', async () => {
    const pulse = await getMatchupPulse(USER, NOW)
    expect(pulse.notRanked.unpriceable).toBe(0)
    expect(pulse.ranked).toBe(1)
    /* 20 against 12, two starters each: a +8 lead priced from a roster no manager id could reach. */
    expect(pulse.leading[0]?.margin).toBe(8)
    expect(pulse.leading[0]?.basis).toBe('projected')
  })

  it('asks for the orphan key by name, and still asks for the manager keys', async () => {
    await getMatchupPulse(USER, NOW)
    const keys = (db.rosterWhere.at(-1)?.platformUserId as { in: string[] }).in
    expect(keys).toContain('orphan-sleeper-2')
    expect(keys).toContain('me-sleeper')
    /* Derived, not fetched wholesale: the read is still key-scoped. */
    expect(keys.length).toBeLessThan(10)
  })

  it('still prices a normally-keyed opponent', async () => {
    db.teams[1] = { ...db.teams[1], platformUserId: 'them-sleeper' }
    db.rosters[1] = { leagueId: 'L1', platformUserId: 'them-sleeper', playerData: { starters: ['c', 'd'] } }
    const pulse = await getMatchupPulse(USER, NOW)
    expect(pulse.ranked).toBe(1)
    expect(pulse.leading[0]?.margin).toBe(8)
  })

  /*
   * 🛑 A Fleaflicker/MFL/Fantrax/Yahoo roster holds the provider's ids, short numbers in Sleeper's
   * range. Here they ARE priced ids in the fake projection feed — the collision shape. Pricing them
   * ranks a margin computed from strangers' projections.
   */
  it('🛑 never prices a foreign-id lineup as Sleeper ids — the league is unpriceable, not ranked', async () => {
    db.claimed = [{ externalId: '1', platformUserId: 'me-sleeper', league: { ...LEAGUE, platform: 'fleaflicker' } }]
    db.teams[1] = { ...db.teams[1], platformUserId: 'them-sleeper' }
    db.rosters[1] = { leagueId: 'L1', platformUserId: 'them-sleeper', playerData: { starters: ['c', 'd'] } }
    const pulse = await getMatchupPulse(USER, NOW)
    expect(pulse.ranked).toBe(0)
    expect(pulse.leading).toHaveLength(0)
    expect(pulse.notRanked.unpriceable).toBe(1)
  })

  it('CONTROL: the same lineups in a Sleeper league are priced', async () => {
    db.teams[1] = { ...db.teams[1], platformUserId: 'them-sleeper' }
    db.rosters[1] = { leagueId: 'L1', platformUserId: 'them-sleeper', playerData: { starters: ['c', 'd'] } }
    const pulse = await getMatchupPulse(USER, NOW)
    expect(pulse.ranked).toBe(1)
    expect(pulse.leading[0]?.margin).toBe(8)
  })

  it('reports a pairing it cannot price rather than inventing one', async () => {
    db.rosters = [db.rosters[0]]
    const pulse = await getMatchupPulse(USER, NOW)
    expect(pulse.ranked).toBe(0)
    expect(pulse.leading).toHaveLength(0)
    expect(pulse.trailing).toHaveLength(0)
    expect(pulse.notRanked.unpriceable).toBe(1)
  })
})

/*
 * The importer stores an unowned Sleeper roster as teamName "Unknown" / ownerName "Unknown" (252
 * teams across 37 leagues on 2026-09-29). The board printed "vs Unknown" for it while Your Week
 * said "opponent not named" and the home "vs Roster 8" — one roster, three names.
 */
describe('getMatchupPulse opponent label', () => {
  it('a stored "Unknown" is no name: the row is "Team 2", the same label every surface uses', async () => {
    db.teams[1] = { ...db.teams[1], teamName: 'Unknown', ownerName: 'Unknown' }
    const row = (await getMatchupPulse(USER, NOW)).leading[0]
    expect(row).toMatchObject({ opponentName: null, opponentLabel: 'Team 2', opponentInitials: expect.any(String) })
  })

  it('a real name is kept as the label', async () => {
    const row = (await getMatchupPulse(USER, NOW)).leading[0]
    expect(row).toMatchObject({ opponentName: 'Theirs', opponentLabel: 'Theirs' })
  })
})

/*
 * The Tuesday after a week: every NFL game final, the platform still on that week. The row is a
 * result (`final`), so the board says won/lost — App Review account, 2026-09-29, read "0 leading ·
 * 3 trailing" about three finished games.
 */
describe('getMatchupPulse finished week', () => {
  const tuesday = () => {
    db.claimed = [{ externalId: '1', platformUserId: 'me-sleeper', league: { ...LEAGUE, settings: { ...LEAGUE.settings, leg: 2 } } }]
    db.weekRows[0].pointsFor = 90
    db.weekRows[0].pointsAgainst = 130
    db.weekRows[1].pointsFor = 130
    db.weekRows[1].pointsAgainst = 90
  }
  const game = (status: string) => ({
    season: 2026, week: 2, homeTeam: 'CHI', awayTeam: 'PHI', status, seasonType: 'regular',
    startTime: new Date('2026-09-15T00:15:00Z'), fetchedAt: new Date('2026-09-16T12:00:00Z'),
  })

  it('every game of the week final: the row is final and the board is all results', async () => {
    tuesday()
    db.games = [game('final')]
    const pulse = await getMatchupPulse(USER, NOW)
    expect(pulse.trailing[0]).toMatchObject({ basis: 'scored', margin: -40, final: true })
    expect(pulse.allFinal).toBe(true)
  })

  it('a game still to play: the row stays live', async () => {
    tuesday()
    db.games = [game('final'), { ...game('scheduled'), homeTeam: 'BUF', awayTeam: 'MIA' }]
    const pulse = await getMatchupPulse(USER, NOW)
    expect(pulse.trailing[0]).toMatchObject({ basis: 'scored', final: false })
    expect(pulse.allFinal).toBe(false)
  })

  it('a projected row is never final', async () => {
    db.games = [game('final')]
    const pulse = await getMatchupPulse(USER, NOW)
    expect(pulse.leading[0]).toMatchObject({ basis: 'projected', final: false })
    expect(pulse.allFinal).toBe(false)
  })
})

/*
 * 🛑 A GUILLOTINE LEAGUE IS NOT A HEAD-TO-HEAD, EVEN WITH MATCHUP IDS ON ITS ROWS. Production
 * 2026-10-02: "Survivor All-Stars Guillotine" and "2026 BB Guilly League!" were ranked with a win
 * probability against a provider-paired "opponent" while the rail showed them as elimination rows.
 */
describe('getMatchupPulse — elimination formats', () => {
  const pairedOpponent = () => {
    db.teams[1] = { ...db.teams[1], platformUserId: 'them-sleeper' }
    db.rosters[1] = { leagueId: 'L1', platformUserId: 'them-sleeper', playerData: { starters: ['c', 'd'] } }
  }

  it('🛑 a guillotine league is counted as elimination, never ranked', async () => {
    pairedOpponent()
    db.claimed = [{ externalId: '1', platformUserId: 'me-sleeper', league: { ...LEAGUE, leagueType: 'guillotine' } }]
    const pulse = await getMatchupPulse(USER, NOW)
    expect(pulse.ranked).toBe(0)
    expect(pulse.leading).toHaveLength(0)
    expect(pulse.notRanked.elimination).toBe(1)
  })

  it('🛑 a BEST-BALL guillotine (type best_ball, guillotineMode on) is elimination too', async () => {
    pairedOpponent()
    db.claimed = [{ externalId: '1', platformUserId: 'me-sleeper', league: { ...LEAGUE, leagueType: 'best_ball', guillotineMode: true } }]
    const pulse = await getMatchupPulse(USER, NOW)
    expect(pulse.ranked).toBe(0)
    expect(pulse.notRanked.elimination).toBe(1)
  })

  it('CONTROL: the same paired league without the format is ranked', async () => {
    pairedOpponent()
    db.claimed = [{ externalId: '1', platformUserId: 'me-sleeper', league: { ...LEAGUE, leagueType: 'redraft', guillotineMode: false } }]
    const pulse = await getMatchupPulse(USER, NOW)
    expect(pulse.ranked).toBe(1)
    expect(pulse.notRanked.elimination).toBe(0)
  })
})

/*
 * 🛑 A FAILED CORE READ IS A FAILURE, NOT AN EMPTY BOARD. Swallowed, these turned "we could not read"
 * into "No claimed team yet" or every league "carries no schedule". They now reach the page.
 */
describe('getMatchupPulse — core reads that fail', () => {
  it('🛑 a failed claimed-teams read rejects', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.leagueTeam.findMany).mockRejectedValueOnce(new Error('db down'))
    await expect(getMatchupPulse(USER, NOW)).rejects.toThrow('db down')
  })

  it('🛑 a failed schedule read rejects', async () => {
    const { prisma } = await import('@/lib/prisma')
    vi.mocked(prisma.weeklyMatchup.groupBy).mockRejectedValueOnce(new Error('timeout') as never)
    await expect(getMatchupPulse(USER, NOW)).rejects.toThrow('timeout')
  })
})

/*
 * 🛑 THE SETTINGS READ LEAVES OUT THE KEYS THIS BOARD NEVER READS (2026-10-03). `settings: true` sent
 * ~5 MB per render on a 95-league account, 4.07 MB of it `identity_mappings`. Measured on production:
 * the five settings readers give identical answers for all 95 leagues on the slim read.
 */
describe('getMatchupPulse — the settings read', () => {
  it('🛑 the claimed-teams query no longer selects settings at all', async () => {
    const { prisma } = await import('@/lib/prisma')
    await getMatchupPulse(USER, NOW)
    const claimCall = vi.mocked(prisma.leagueTeam.findMany).mock.calls.find(([a]) => (a as { where: Record<string, unknown> }).where.claimedByUserId)
    const leagueSelect = (claimCall?.[0] as { select: { league: { select: Record<string, unknown> } } }).select.league.select
    expect(leagueSelect.settings).toBeUndefined()
  })

  it('🛑 settings come from one SQL read per league, with identity_mappings dropped', async () => {
    const { prisma } = await import('@/lib/prisma')
    /* Two claimed teams in the same league: the read still asks for it once. */
    db.claimed = [db.claimed[0], { ...db.claimed[0], externalId: '3' }]
    await getMatchupPulse(USER, NOW)
    const raw = vi.mocked(prisma.$queryRawUnsafe).mock.calls
    expect(raw).toHaveLength(1)
    const [sql, ids] = raw[0] as [string, string[]]
    expect(sql).toMatch(/- 'identity_mappings'/)
    expect(sql).toMatch(/jsonb_typeof\(settings::jsonb\) = 'object'/)
    expect(ids).toEqual(['L1'])
  })

  it('CONTROL: the slim settings still drive the board — the league is priced under its rules', async () => {
    db.teams[1] = { ...db.teams[1], platformUserId: 'them-sleeper' }
    db.rosters[1] = { leagueId: 'L1', platformUserId: 'them-sleeper', playerData: { starters: ['c', 'd'] } }
    const pulse = await getMatchupPulse(USER, NOW)
    expect(pulse.ranked).toBe(1)
    expect(pulse.leading[0]?.margin).toBe(8)
  })
})
