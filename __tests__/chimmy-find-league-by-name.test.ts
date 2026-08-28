import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const leagueFindMany = vi.hoisted(() => vi.fn())
const redraftMemberFindMany = vi.hoisted(() => vi.fn())
const rosterFindMany = vi.hoisted(() => vi.fn())
const leagueTeamFindMany = vi.hoisted(() => vi.fn())
const leagueTeamCount = vi.hoisted(() => vi.fn())
const legacyLeagueFindMany = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findMany: leagueFindMany },
    redraftLeagueMember: { findMany: redraftMemberFindMany },
    roster: { findMany: rosterFindMany },
    leagueTeam: { findMany: leagueTeamFindMany, count: leagueTeamCount },
    legacyLeague: { findMany: legacyLeagueFindMany },
  },
}))

import { findLeagueByName } from '@/lib/chimmy/tools/leagueByName'

/** `league.findMany` is called twice: once for owned ids, once to load names. */
function withLeagues(
  rows: Array<{
    id: string
    name: string | null
    season?: number
    platformLeagueId?: string | null
    userId?: string | null
  }>,
) {
  leagueFindMany.mockImplementation((args: any) => {
    if (args?.where?.id?.in) {
      return Promise.resolve(
        rows
          .filter((r) => args.where.id.in.includes(r.id))
          .map((r) => ({
            id: r.id,
            name: r.name,
            sport: 'NFL',
            season: r.season ?? 2026,
            /* Distinct by default, so existing cases are never collapsed. */
            platformLeagueId: r.platformLeagueId ?? `platform-${r.id}`,
            userId: r.userId ?? null,
          })),
      )
    }
    return Promise.resolve([])
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  redraftMemberFindMany.mockResolvedValue([])
  rosterFindMany.mockResolvedValue([])
  leagueTeamFindMany.mockResolvedValue([])
  leagueTeamCount.mockResolvedValue(0)
  legacyLeagueFindMany.mockResolvedValue([])
})

describe('findLeagueByName', () => {
  it('resolves the name the user actually typed', async () => {
    leagueTeamFindMany.mockResolvedValue([{ leagueId: 'l-kbfl' }])
    withLeagues([{ id: 'l-kbfl', name: 'KBFL' }])

    const out = await findLeagueByName('user-1', 'KBFL')

    expect(out.kind).toBe('match')
    expect(out.kind === 'match' && out.league.id).toBe('l-kbfl')
  })

  it('ignores case and punctuation', async () => {
    rosterFindMany.mockResolvedValue([{ leagueId: 'l-1' }])
    withLeagues([{ id: 'l-1', name: 'Dynasty for life!' }])

    const out = await findLeagueByName('user-1', 'dynasty for life')
    expect(out.kind).toBe('match')
  })

  /*
   * ⚠ AN EXACT NAME MUST NOT LOSE TO A LONGER ONE CONTAINING IT. "KBFL" is a
   * substring of "KBFL Dynasty", so a contains-first search would call this
   * ambiguous and refuse a question that had exactly one right answer.
   */
  it('prefers an exact name over a longer one containing it', async () => {
    leagueTeamFindMany.mockResolvedValue([{ leagueId: 'l-a' }, { leagueId: 'l-b' }])
    withLeagues([
      { id: 'l-a', name: 'KBFL' },
      { id: 'l-b', name: 'KBFL Dynasty' },
    ])

    const out = await findLeagueByName('user-1', 'KBFL')
    expect(out.kind === 'match' && out.league.id).toBe('l-a')
  })

  /*
   * ⚠ GUESSING IS THE WORST OUTCOME. Someone in 65 leagues has several called
   * "Dynasty something"; a confident answer about the wrong one is
   * indistinguishable from a right one.
   */
  it('refuses to pick when two leagues match', async () => {
    leagueTeamFindMany.mockResolvedValue([{ leagueId: 'l-a' }, { leagueId: 'l-b' }])
    withLeagues([
      { id: 'l-a', name: 'Dynasty for life' },
      { id: 'l-b', name: 'Dynasty BestBall' },
    ])

    const out = await findLeagueByName('user-1', 'dynasty')
    expect(out.kind).toBe('ambiguous')
    expect(out.kind === 'ambiguous' && out.candidates).toHaveLength(2)
  })

  it('offers the real names when nothing matches', async () => {
    rosterFindMany.mockResolvedValue([{ leagueId: 'l-1' }])
    withLeagues([{ id: 'l-1', name: 'Loyal Dynasty Playas' }])

    const out = await findLeagueByName('user-1', 'Premier League')
    expect(out.kind).toBe('none')
    expect(out.kind === 'none' && out.known.map((l) => l.name)).toEqual(['Loyal Dynasty Playas'])
  })

  /*
   * ⚠ THE SECURITY PROPERTY. Candidates are built from MEMBERSHIP FIRST, so a
   * league the user is not in is never even loaded — which is what stops "does a
   * league called X exist?" being answerable by anyone.
   */
  it('never looks outside the leagues the user belongs to', async () => {
    leagueTeamFindMany.mockResolvedValue([{ leagueId: 'mine' }])
    withLeagues([
      { id: 'mine', name: 'My League' },
      { id: 'theirs', name: 'Secret League' },
    ])

    const out = await findLeagueByName('user-1', 'Secret League')

    expect(out.kind).toBe('none')
    /* The name-loading query was scoped to the membership ids, not all leagues. */
    const nameQuery = leagueFindMany.mock.calls.find((c) => c[0]?.where?.id?.in)
    expect(nameQuery?.[0].where.id.in).toEqual(['mine'])
  })

  it('covers all four membership routes', async () => {
    leagueFindMany.mockImplementation((args: any) => {
      if (args?.where?.id?.in) {
        return Promise.resolve(
          args.where.id.in.map((id: string) => ({ id, name: id, sport: 'NFL', season: 2026 })),
        )
      }
      /* The owner query. */
      return Promise.resolve([{ id: 'owned' }])
    })
    redraftMemberFindMany.mockResolvedValue([{ leagueId: 'redraft' }])
    rosterFindMany.mockResolvedValue([{ leagueId: 'roster' }])
    leagueTeamFindMany.mockResolvedValue([{ leagueId: 'claimed' }])

    const out = await findLeagueByName('user-1', 'nothing-matches-this')

    expect(out.kind).toBe('none')
    expect(out.kind === 'none' && out.known.map((l) => l.id).sort()).toEqual([
      'claimed',
      'owned',
      'redraft',
      'roster',
    ])
  })

  /*
   * ⚠ THE REAL CASE, FROM PRODUCTION. `League` carries a `season` column and an
   * import writes a row per season, so KBFL exists twice. Chimmy asked "which of
   * the two KBFL leagues did you mean?" — unanswerable, because both are called
   * KBFL. The year the user already said is what separates them.
   */
  it('resolves identically named leagues by the season the user gave', async () => {
    leagueTeamFindMany.mockResolvedValue([{ leagueId: 'l-2025' }, { leagueId: 'l-2026' }])
    withLeagues([
      { id: 'l-2026', name: 'KBFL', season: 2026 },
      { id: 'l-2025', name: 'KBFL', season: 2025 },
    ])

    /* Without a season it must still refuse to guess. */
    expect((await findLeagueByName('user-1', 'KBFL')).kind).toBe('ambiguous')

    const out = await findLeagueByName('user-1', 'KBFL', 2025)
    expect(out.kind === 'match' && out.league.id).toBe('l-2025')
  })

  /*
   * A year that matches nothing must not erase the league — better to ask which
   * of the two than to claim a league they are plainly in does not exist.
   */
  it('falls back to asking when the season matches no row', async () => {
    leagueTeamFindMany.mockResolvedValue([{ leagueId: 'l-2025' }, { leagueId: 'l-2026' }])
    withLeagues([
      { id: 'l-2026', name: 'KBFL', season: 2026 },
      { id: 'l-2025', name: 'KBFL', season: 2025 },
    ])

    const out = await findLeagueByName('user-1', 'KBFL', 1999)
    expect(out.kind).toBe('ambiguous')
  })

  it('carries the season through on a unique match so callers can show it', async () => {
    rosterFindMany.mockResolvedValue([{ leagueId: 'l-1' }])
    withLeagues([{ id: 'l-1', name: 'Solo League', season: 2024 }])

    const out = await findLeagueByName('user-1', 'Solo League')
    expect(out.kind === 'match' && out.league.season).toBe(2024)
  })

  /*
   * ⚠ THE REPO REALLY HOLDS DUPLICATE LEAGUE ROWS. KBFL resolved to two rows
   * with the same name, sport AND season, so "which did you mean?" became a
   * question with no answer — there is no difference for the reader to name.
   */
  describe('duplicate rows that name, sport and season cannot separate', () => {
    beforeEach(() => {
      leagueTeamFindMany.mockResolvedValue([{ leagueId: 'dup-a' }, { leagueId: 'dup-b' }])
      withLeagues([
        { id: 'dup-a', name: 'KBFL', season: 2026 },
        { id: 'dup-b', name: 'KBFL', season: 2026 },
      ])
    })

    /*
     * Choosing the only row with teams is choosing the only row that can answer
     * anything — the empty shell returns "no standings stored" whatever is
     * asked. That is a resolution, not a guess.
     */
    it('picks the populated row when the other is an empty shell', async () => {
      leagueTeamCount.mockImplementation(({ where }: any) =>
        Promise.resolve(where.leagueId === 'dup-a' ? 0 : 32),
      )

      const out = await findLeagueByName('user-1', 'KBFL')
      expect(out.kind === 'match' && out.league.id).toBe('dup-b')
    })

    /* Two REAL leagues is a genuine choice, and still gets asked. */
    it('still refuses when both rows have teams', async () => {
      leagueTeamCount.mockResolvedValue(12)

      const out = await findLeagueByName('user-1', 'KBFL')
      expect(out.kind).toBe('ambiguous')
      expect(out.kind === 'ambiguous' && out.candidates.every((c) => c.teamCount === 12)).toBe(true)
    })

    /* Both empty: nothing to prefer, so ask rather than pick arbitrarily. */
    it('asks when neither row has any teams', async () => {
      leagueTeamCount.mockResolvedValue(0)
      expect((await findLeagueByName('user-1', 'KBFL')).kind).toBe('ambiguous')
    })

    /* The counts are what let the model ask an answerable question. */
    it('reports the team counts so the question can name a difference', async () => {
      leagueTeamCount.mockImplementation(({ where }: any) =>
        Promise.resolve(where.leagueId === 'dup-a' ? 8 : 32),
      )

      const out = await findLeagueByName('user-1', 'KBFL')
      /* Numeric sort: bare .sort() is lexicographic, so [32, 8] would "pass" unsorted. */
      const counts =
        out.kind === 'ambiguous' ? out.candidates.map((c) => c.teamCount ?? 0).sort((a, b) => a - b) : []
      expect(counts).toEqual([8, 32])
    })
  })

  /*
   * ⚠ THE ACTUAL PRODUCTION CASE, CONFIRMED BY AUDIT. KBFL is ONE Sleeper
   * league (platform id 1338541390891606016) imported TWICE — `leagues.userId`
   * is the importer, so a league produces one row per manager who imports it.
   * This user reaches their own copy as owner and a co-manager's copy through a
   * claimed team. Both rows held an identical 32 teams and 32 rosters, so
   * "which did you mean?" was unanswerable AND pointless: same league either way.
   */
  describe('one real league imported by two managers', () => {
    beforeEach(() => {
      leagueTeamFindMany.mockResolvedValue([{ leagueId: 'mine' }, { leagueId: 'theirs' }])
      leagueTeamCount.mockResolvedValue(32)
    })

    it('collapses copies sharing a platform id instead of asking', async () => {
      withLeagues([
        { id: 'theirs', name: 'KBFL', season: 2026, platformLeagueId: '1338', userId: 'other' },
        { id: 'mine', name: 'KBFL', season: 2026, platformLeagueId: '1338', userId: 'user-1' },
      ])

      const out = await findLeagueByName('user-1', 'KBFL')

      expect(out.kind).toBe('match')
      /* And it is the user's OWN import that survives. */
      expect(out.kind === 'match' && out.league.id).toBe('mine')
    })

    it('keeps a copy even when none of them is the user\'s own import', async () => {
      withLeagues([
        { id: 'a', name: 'KBFL', season: 2026, platformLeagueId: '1338', userId: 'other-1' },
        { id: 'b', name: 'KBFL', season: 2026, platformLeagueId: '1338', userId: 'other-2' },
      ])
      leagueTeamFindMany.mockResolvedValue([{ leagueId: 'a' }, { leagueId: 'b' }])

      const out = await findLeagueByName('user-1', 'KBFL')
      expect(out.kind).toBe('match')
    })

    /*
     * ⚠ DIFFERENT SEASONS OF ONE LEAGUE SHARE A PLATFORM ID ON SOME PROVIDERS,
     * and they are NOT the same thing — collapsing them would silently answer
     * about the wrong year. The key includes the season for that reason.
     */
    it('does not collapse different seasons of the same platform league', async () => {
      withLeagues([
        { id: 's26', name: 'KBFL', season: 2026, platformLeagueId: '1338', userId: 'user-1' },
        { id: 's25', name: 'KBFL', season: 2025, platformLeagueId: '1338', userId: 'user-1' },
      ])
      leagueTeamFindMany.mockResolvedValue([{ leagueId: 's26' }, { leagueId: 's25' }])

      expect((await findLeagueByName('user-1', 'KBFL')).kind).toBe('ambiguous')
      const out = await findLeagueByName('user-1', 'KBFL', 2025)
      expect(out.kind === 'match' && out.league.id).toBe('s25')
    })

    /* No platform id means no evidence they are the same — never collapse. */
    it('leaves rows without a platform id alone', async () => {
      withLeagues([
        { id: 'x', name: 'KBFL', season: 2026, platformLeagueId: null, userId: 'user-1' },
        { id: 'y', name: 'KBFL', season: 2026, platformLeagueId: null, userId: 'user-1' },
      ])
      leagueTeamFindMany.mockResolvedValue([{ leagueId: 'x' }, { leagueId: 'y' }])

      expect((await findLeagueByName('user-1', 'KBFL')).kind).toBe('ambiguous')
    })
  })

  /*
   * ⚠ THE PAST SEASONS ARE IN A DIFFERENT TABLE AND A DIFFERENT ID SPACE.
   * `/leagues` renders KBFL for 2022-2026, but only 2026 is in `leagues`;
   * 2022-2025 are LegacyLeague rows, and ZERO `leagues` rows carry a
   * `legacyLeagueId`, so nothing joins them. Chimmy said "no KBFL league exists
   * for the 2025 season" about a league on the user's own leagues page.
   */
  describe('seasons that exist only as legacy imports', () => {
    const legacyRow = (season: number) => ({
      name: 'KBFL',
      season,
      sport: 'NFL',
      teamCount: 32,
      leagueType: 'Dynasty',
      scoringType: 'PPR',
      isSF: false,
      isTEP: true,
      tepBonus: 0.5,
    })

    it('finds the season the modern tables do not have', async () => {
      leagueFindMany.mockResolvedValue([])
      legacyLeagueFindMany.mockResolvedValue([legacyRow(2025), legacyRow(2024)])

      const out = await findLeagueByName('user-1', 'KBFL', 2025)

      expect(out.kind).toBe('legacy')
      expect(out.kind === 'legacy' && out.facts.season).toBe(2025)
      /* The format question that was previously unanswerable. */
      expect(out.kind === 'legacy' && out.facts.isTep).toBe(true)
      expect(out.kind === 'legacy' && out.facts.tepBonus).toBe(0.5)
    })

    /* A modern row must always win — it has rosters behind it. */
    it('prefers a real league over a legacy row of the same name', async () => {
      leagueTeamFindMany.mockResolvedValue([{ leagueId: 'live' }])
      withLeagues([{ id: 'live', name: 'KBFL', season: 2026 }])
      legacyLeagueFindMany.mockResolvedValue([legacyRow(2026)])

      const out = await findLeagueByName('user-1', 'KBFL')
      expect(out.kind).toBe('match')
    })

    it('falls back to the newest legacy season when none is named', async () => {
      leagueFindMany.mockResolvedValue([])
      legacyLeagueFindMany.mockResolvedValue([legacyRow(2025), legacyRow(2022)])

      const out = await findLeagueByName('user-1', 'KBFL')
      expect(out.kind === 'legacy' && out.facts.season).toBe(2025)
    })

    it('still reports none when neither table knows the name', async () => {
      leagueFindMany.mockResolvedValue([])
      legacyLeagueFindMany.mockResolvedValue([legacyRow(2025)])

      expect((await findLeagueByName('user-1', 'Premier League')).kind).toBe('none')
    })
  })

  it('survives a user with no leagues at all', async () => {
    leagueFindMany.mockResolvedValue([])
    const out = await findLeagueByName('user-1', 'KBFL')
    expect(out.kind).toBe('none')
    expect(out.kind === 'none' && out.known).toEqual([])
  })
})
