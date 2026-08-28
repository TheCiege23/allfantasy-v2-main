import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const leagueFindMany = vi.hoisted(() => vi.fn())
const redraftMemberFindMany = vi.hoisted(() => vi.fn())
const rosterFindMany = vi.hoisted(() => vi.fn())
const leagueTeamFindMany = vi.hoisted(() => vi.fn())
const leagueTeamCount = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findMany: leagueFindMany },
    redraftLeagueMember: { findMany: redraftMemberFindMany },
    roster: { findMany: rosterFindMany },
    leagueTeam: { findMany: leagueTeamFindMany, count: leagueTeamCount },
  },
}))

import { findLeagueByName } from '@/lib/chimmy/tools/leagueByName'

/** `league.findMany` is called twice: once for owned ids, once to load names. */
function withLeagues(rows: Array<{ id: string; name: string | null; season?: number }>) {
  leagueFindMany.mockImplementation((args: any) => {
    if (args?.where?.id?.in) {
      return Promise.resolve(
        rows
          .filter((r) => args.where.id.in.includes(r.id))
          .map((r) => ({ id: r.id, name: r.name, sport: 'NFL', season: r.season ?? 2026 })),
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

  it('survives a user with no leagues at all', async () => {
    leagueFindMany.mockResolvedValue([])
    const out = await findLeagueByName('user-1', 'KBFL')
    expect(out.kind).toBe('none')
    expect(out.kind === 'none' && out.known).toEqual([])
  })
})
