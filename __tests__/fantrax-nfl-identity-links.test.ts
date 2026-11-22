/**
 * Fantrax NFL player ids reach `PlayerIdentityMap.fantraxId`.
 *
 * 🛑 WHAT WAS WRONG: the column exists and every Fantrax roster reader resolves through it
 * (`resolveRosterPlayerIdentities`, `resolveProviderRosterPlayers`), but only CFB, MLB, NBA and NHL
 * ever WROTE it. Nothing linked an NFL row, so an NFL Fantrax roster resolved zero players by id —
 * no headshot, projection or valuation — for every NFL Fantrax league.
 *
 * Now the import links the players it already receives (rostered and drafted ids, named by the
 * `getPlayerIds?sport=NFL` map it already fetches): BY ID FIRST — a row already carrying that
 * Fantrax id is the answer — and by NAME SECOND, only on exact name + recognised NFL team +
 * compatible position, never on a name alone, never over an existing link.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  findUnique: vi.fn(), updateMany: vi.fn(), upsert: vi.fn(), userUpsert: vi.fn(),
  identityFindMany: vi.fn(), executeRaw: vi.fn(), queryRaw: vi.fn(),
  info: vi.fn(), rosters: vi.fn(), standings: vi.fn(), players: vi.fn(), schedule: vi.fn(), draft: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {
  fantraxLeague: { findUnique: h.findUnique, updateMany: h.updateMany, upsert: h.upsert },
  fantraxUser: { upsert: h.userUpsert },
  playerIdentityMap: { findMany: h.identityFindMany },
  $executeRaw: h.executeRaw,
  $queryRaw: h.queryRaw,
} }))
vi.mock('@/lib/league-import/fantrax/fantraxApi', async (original) => ({
  ...await original<object>(),
  getFantraxLeagueInfo: h.info, getFantraxTeamRosters: h.rosters,
  getFantraxStandings: h.standings, getFantraxPlayerIds: h.players,
  fetchFantraxScheduleWithScores: h.schedule, getFantraxDraftResults: h.draft,
  // Not under test here; without this the real client would call Fantrax.
  getFantraxDraftPicks: vi.fn(async () => ({ ok: false, failure: { kind: 'not_found', message: 'not read in this test' } })),
}))
import { importFantraxLeague } from '@/lib/league-import/fantrax/importFantraxLeague'
import { planNflFantraxIdentityLinks } from '@/lib/player-identity/nflFantraxIdentityPlan'

const ref = (fantraxId: string, name: string, team: string, position: string) => ({ fantraxId, name, team, position })
const row = (id: string, canonicalName: string, currentTeam: string | null, position: string | null, fantraxId: string | null = null) =>
  ({ id, canonicalName, currentTeam, position, fantraxId })

describe('planNflFantraxIdentityLinks', () => {
  it('links on exact name + recognised team + compatible position, by id first', () => {
    const plan = planNflFantraxIdentityLinks(
      [
        ref('f1', 'Allen, Josh', 'BUF', 'QB'),
        ref('f2', 'Mahomes, Patrick', 'Kansas City Chiefs', 'QB'),
        ref('f3', 'Kelce, Travis', 'KC', 'TE'),
      ],
      [
        row('r1', 'Josh Allen', 'BUF', 'QB'),
        row('r2', 'Patrick Mahomes', 'KC', 'QB'),
        row('r3', 'Travis Kelce', 'KC', 'TE', 'f3'),
      ],
    )
    expect(plan.links).toEqual([{ id: 'r1', fantraxId: 'f1' }, { id: 'r2', fantraxId: 'f2' }])
    expect(plan.resolvedById).toBe(1)
  })

  it('never links on a name alone, an unrecognised team or an incompatible position', () => {
    const plan = planNflFantraxIdentityLinks(
      [
        ref('f1', 'Allen, Josh', '(N/A)', 'QB'),
        ref('f2', 'Allen, Josh', 'BUF', 'LB'),
        ref('f3', 'Allen, Josh', 'MIA', 'QB'),
      ],
      [row('r1', 'Josh Allen', 'BUF', 'QB')],
    )
    expect(plan.links).toEqual([])
    expect(plan.unmatched).toBe(3)
  })

  it('refuses two candidates, an existing different link, and a team defence', () => {
    const plan = planNflFantraxIdentityLinks(
      [
        ref('f1', 'Smith, Mike', 'DAL', 'WR'),
        ref('f2', 'Jones, Ed', 'NYG', 'RB'),
        ref('f3', 'Bills', 'BUF', 'DST'),
      ],
      [
        row('a', 'Mike Smith', 'DAL', 'WR'), row('b', 'Mike Smith', 'Dallas Cowboys', 'WR'),
        row('c', 'Ed Jones', 'NYG', 'RB', 'other-id'),
      ],
    )
    expect(plan.links).toEqual([])
    expect(plan).toMatchObject({ ambiguous: 1, conflicts: 1, teamEntries: 1 })
  })

  /** Staging 2026-11-21: 26 of one league's 139 unlinked players differed from the registry only by an apostrophe. */
  it('links a name Fantrax writes without its apostrophe, still on team + position', () => {
    const plan = planNflFantraxIdentityLinks(
      [
        ref('f1', 'Chase, JaMarr', 'CIN', 'WR'),
        ref('f2', 'Brown, JiAyir', 'SF', 'S'),
        ref('f3', 'ONeill, Eric', 'DET', 'DE'),
        ref('f4', 'Swift, DAndre', 'DET', 'RB'),
        ref('f5', 'Sneed, LJarius', 'KC', 'QB'),
      ],
      [
        row('r1', "Ja'Marr Chase", 'CIN', 'WR'),
        row('r2', "Ji'ayir Brown", 'SF', 'DB'),
        row('r3', "Eric O'Neill", 'DET', 'DL'),
        row('r4', "D'Andre Swift", 'CHI', 'RB'),
        row('r5', "L'Jarius Sneed", 'KC', 'DB'),
      ],
    )
    expect(plan.links).toEqual([{ id: 'r1', fantraxId: 'f1' }, { id: 'r2', fantraxId: 'f2' }, { id: 'r3', fantraxId: 'f3' }])
    // Another club, or another position, is still refused.
    expect(plan.unmatched).toBe(2)
  })

  it('two rows that differ only by punctuation are ambiguous, never a guess', () => {
    const plan = planNflFantraxIdentityLinks(
      [ref('f1', 'Swift, DAndre', 'CHI', 'RB')],
      [row('a', "D'Andre Swift", 'CHI', 'RB'), row('b', 'Dandre Swift', 'CHI', 'RB')],
    )
    expect(plan.links).toEqual([])
    expect(plan.ambiguous).toBe(1)
  })

  /** Fantrax "Curry, Caden | IND | DE"; registry "Caden Curry / IND / LB". */
  it('treats DL and LB as one edge rusher on the same name and club, and no other pair', () => {
    const plan = planNflFantraxIdentityLinks(
      [
        ref('f1', 'Curry, Caden', 'IND', 'DE'),
        ref('f2', 'Highsmith, Alex', 'PIT', 'LB'),
        ref('f3', 'Jones, Velus', 'SEA', 'RB'),
        ref('f4', 'Lewis, Jourdan', 'JAX', 'CB'),
      ],
      [
        row('r1', 'Caden Curry', 'IND', 'LB'),
        row('r2', 'Alex Highsmith', 'PIT', 'DL'),
        row('r3', 'Velus Jones', 'SEA', 'WR'),
        row('r4', 'Jourdan Lewis', 'JAX', 'LB'),
      ],
    )
    expect(plan.links).toEqual([{ id: 'r1', fantraxId: 'f1' }, { id: 'r2', fantraxId: 'f2' }])
    expect(plan.unmatched).toBe(2)
  })

  /** Staging 2026-11-21: the registry holds "Dru Phillips" for Fantrax's "Phillips, Andru", and 16 more like him. */
  describe('a short first name in the registry', () => {
    const refs = [
      ref('f1', 'Phillips, Andru', 'NYG', 'CB'),
      ref('f2', 'Skattebo, Cameron', 'NYG', 'RB'),
      ref('f3', 'Hibner, Matthew', 'BAL', 'TE'),
    ]
    const surnames = [
      row('r1', 'Dru Phillips', 'NYG', 'DB'),
      row('r2', 'Cam Skattebo', 'NYG', 'RB'),
      row('r3', 'Matt Hibner', 'BAL', 'TE'),
      row('r9', 'Jordan Phillips', 'BUF', 'DL'),
    ]

    it('links the one row with that surname, club and position when the first names are short and long', () => {
      const plan = planNflFantraxIdentityLinks(refs, [], surnames)
      expect(plan.links).toEqual([{ id: 'r1', fantraxId: 'f1' }, { id: 'r2', fantraxId: 'f2' }, { id: 'r3', fantraxId: 'f3' }])
    })

    it('is off without the complete surname rows', () => {
      expect(planNflFantraxIdentityLinks(refs, surnames).links).toEqual([])
      expect(planNflFantraxIdentityLinks(refs, []).links).toEqual([])
    })

    it('refuses a second row with that surname at the club, another club, and an existing link', () => {
      expect(planNflFantraxIdentityLinks(
        [ref('f1', 'Phillips, Andru', 'NYG', 'CB')], [],
        [row('r1', 'Dru Phillips', 'NYG', 'DB'), row('r2', 'Jacob Phillips', 'NYG', 'DB')],
      ).links).toEqual([])
      expect(planNflFantraxIdentityLinks(
        [ref('f1', 'Phillips, Andru', 'DAL', 'CB')], [], [row('r1', 'Dru Phillips', 'NYG', 'DB')],
      ).links).toEqual([])
      const linked = planNflFantraxIdentityLinks(
        [ref('f1', 'Phillips, Andru', 'NYG', 'CB')], [], [row('r1', 'Dru Phillips', 'NYG', 'DB', 'other-id')],
      )
      expect(linked.links).toEqual([])
      expect(linked.conflicts).toBe(1)
    })

    it('refuses first names that nothing connects, however sure a person would be', () => {
      const plan = planNflFantraxIdentityLinks(
        [
          ref('f1', 'Gardner, Ahmad', 'IND', 'CB'),
          ref('f2', 'Martin, Jartavius', 'WAS', 'S'),
          ref('f3', 'Brown, Michael', 'NE', 'S'),
          ref('f4', 'Lee, Al', 'KC', 'WR'),
        ],
        [],
        [
          row('r1', 'Sauce Gardner', 'IND', 'DB'),
          row('r2', 'Quan Martin', 'WAS', 'DB'),
          row('r3', 'Mike Brown', 'NE', 'DB'),
          row('r4', 'Alan Lee', 'KC', 'WR'),
        ],
      )
      expect(plan.links).toEqual([])
      expect(plan.unmatched).toBe(4)
    })
  })
})

describe('the NFL import links the players it received', () => {
  const args = { leagueId: 'vendor-id', teamName: 'My team', appUserId: 'owner', refreshSnapshotId: 'stable-uuid' }
  beforeEach(() => {
    vi.resetAllMocks()
    h.findUnique.mockResolvedValue({ id: 'stable-uuid', appUserId: 'owner', sourceLeagueId: 'vendor-id', season: 2026, sport: 'nfl' })
    h.updateMany.mockResolvedValue({ count: 1 })
    h.info.mockResolvedValue({ ok: true, data: { leagueName: 'L', seasonYear: 2026, rosterInfo: {} } })
    h.rosters.mockResolvedValue({ ok: true, data: { team1: { teamName: 'My team', rosterItems: [
      { id: 'f1', position: 'QB', status: 'ACTIVE' }, { id: 'f9', position: 'WR', status: 'ACTIVE' },
    ] } } })
    h.players.mockImplementation(async (sport: string) => ({ ok: true, data: sport === 'NFL' ? {
      f1: ref('f1', 'Allen, Josh', 'BUF', 'QB'), f9: ref('f9', 'Unknown, Guy', 'BUF', 'WR'),
      unrostered: ref('unrostered', 'Mahomes, Patrick', 'KC', 'QB'),
    } : {} }))
    h.standings.mockResolvedValue({ ok: true, data: [] })
    h.schedule.mockResolvedValue({ rows: [], position: null, periodsRead: 0, periodsFailed: 0 })
    h.draft.mockResolvedValue(null)
    h.identityFindMany.mockResolvedValue([row('r1', 'Josh Allen', 'BUF', 'QB'), row('r2', 'Patrick Mahomes', 'KC', 'QB')])
    h.executeRaw.mockResolvedValue(1)
    h.queryRaw.mockResolvedValue([])
  })

  it('writes only the league players it can match, through the guarded update', async () => {
    expect(await importFantraxLeague(args)).toMatchObject({ ok: true })
    expect(h.identityFindMany).toHaveBeenCalledTimes(1)
    expect(h.executeRaw).toHaveBeenCalledTimes(1)
    const values = h.executeRaw.mock.calls[0].slice(1)
    expect(values).toContain(JSON.stringify([{ id: 'r1', fantraxId: 'f1' }]))
    const sql = (h.executeRaw.mock.calls[0][0] as string[]).join('?')
    expect(sql).toMatch(/"fantraxId" IS NULL/)
    expect(sql).toMatch(/NOT EXISTS/)
  })

  it('reads the registry a second time for a name with no exact match, and links what it finds', async () => {
    h.rosters.mockResolvedValue({ ok: true, data: { team1: { teamName: 'My team', rosterItems: [
      { id: 'f1', position: 'QB', status: 'ACTIVE' }, { id: 'f7', position: 'WR', status: 'ACTIVE' },
    ] } } })
    h.players.mockImplementation(async (sport: string) => ({ ok: true, data: sport === 'NFL' ? {
      f1: ref('f1', 'Allen, Josh', 'BUF', 'QB'), f7: ref('f7', 'Chase, JaMarr', 'CIN', 'WR'),
    } : {} }))
    h.queryRaw.mockResolvedValue([row('r7', "Ja'Marr Chase", 'CIN', 'WR')])
    expect(await importFantraxLeague(args)).toMatchObject({ ok: true })
    // Only the name the first read did not find is asked for, with its punctuation removed.
    expect(h.queryRaw).toHaveBeenCalledTimes(1)
    expect(h.queryRaw.mock.calls[0].slice(1)).toEqual([['jamarr chase']])
    expect((h.queryRaw.mock.calls[0][0] as string[]).join('?')).toContain("'[^a-z0-9 ]'")
    expect(h.executeRaw.mock.calls[0].slice(1)).toContain(
      JSON.stringify([{ id: 'r1', fantraxId: 'f1' }, { id: 'r7', fantraxId: 'f7' }]),
    )
  })

  /** Staging 2026-11-21: the stored name of 45 NFL rows keeps the suffix ("marvin mims jr."), so the first read misses them. */
  it('the second read finds a row whose stored name kept its suffix, and links it', async () => {
    h.rosters.mockResolvedValue({ ok: true, data: { team1: { teamName: 'My team', rosterItems: [
      { id: 'f5', position: 'WR', status: 'ACTIVE' },
    ] } } })
    h.players.mockImplementation(async (sport: string) => ({ ok: true, data: sport === 'NFL' ? {
      f5: ref('f5', 'Mims Jr., Marvin', 'DEN', 'WR'),
    } : {} }))
    h.identityFindMany.mockResolvedValue([])
    h.queryRaw.mockResolvedValue([row('r5', 'Marvin Mims Jr.', 'DEN', 'WR')])
    expect(await importFantraxLeague(args)).toMatchObject({ ok: true })
    expect(h.queryRaw.mock.calls[0].slice(1)).toEqual([['marvin mims']])
    expect((h.queryRaw.mock.calls[0][0] as string[]).join('?')).toContain("' (jr|sr|ii|iii|iv|v)$'")
    expect(h.executeRaw.mock.calls[0].slice(1)).toContain(JSON.stringify([{ id: 'r5', fantraxId: 'f5' }]))
  })

  it('reads every row with the surname of a player no name read found, and links the short name', async () => {
    h.rosters.mockResolvedValue({ ok: true, data: { team1: { teamName: 'My team', rosterItems: [
      { id: 'f1', position: 'QB', status: 'ACTIVE' }, { id: 'f8', position: 'CB', status: 'ACTIVE' },
    ] } } })
    h.players.mockImplementation(async (sport: string) => ({ ok: true, data: sport === 'NFL' ? {
      f1: ref('f1', 'Allen, Josh', 'BUF', 'QB'), f8: ref('f8', 'Phillips, Andru', 'NYG', 'CB'),
    } : {} }))
    // Second read (the name without punctuation) finds nothing; third read (the surname) finds him.
    h.queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([row('r8', 'Dru Phillips', 'NYG', 'DB')])
    expect(await importFantraxLeague(args)).toMatchObject({ ok: true })
    expect(h.queryRaw).toHaveBeenCalledTimes(2)
    expect(h.queryRaw.mock.calls[1].slice(1)).toEqual([['% phillips']])
    expect((h.queryRaw.mock.calls[1][0] as string[]).join('?')).toContain('LIKE ANY(')
    expect(h.executeRaw.mock.calls[0].slice(1)).toContain(
      JSON.stringify([{ id: 'r1', fantraxId: 'f1' }, { id: 'r8', fantraxId: 'f8' }]),
    )
  })

  it('a failing second read still links the exact matches', async () => {
    h.queryRaw.mockRejectedValue(new Error('function regexp_replace does not exist'))
    expect(await importFantraxLeague(args)).toMatchObject({ ok: true })
    expect(h.executeRaw.mock.calls[0].slice(1)).toContain(JSON.stringify([{ id: 'r1', fantraxId: 'f1' }]))
  })

  it('a failing identity step never fails the import', async () => {
    h.identityFindMany.mockRejectedValue(Object.assign(new Error('relation missing'), { code: 'P2021' }))
    expect(await importFantraxLeague(args)).toMatchObject({ ok: true })
    expect(h.updateMany).toHaveBeenCalledTimes(1)
  })

  it('does nothing for a non-NFL league', async () => {
    h.findUnique.mockResolvedValue({ id: 'stable-uuid', appUserId: 'owner', sourceLeagueId: 'vendor-id', season: 2026, sport: 'mlb' })
    h.players.mockImplementation(async (sport: string) => ({ ok: true, data: sport === 'MLB' ? {
      f1: ref('f1', 'Judge, Aaron', 'NYY', 'OF'), f9: ref('f9', 'Soto, Juan', 'NYM', 'OF'),
    } : {} }))
    expect(await importFantraxLeague(args)).toMatchObject({ ok: true })
    expect(h.identityFindMany).not.toHaveBeenCalled()
  })
})
