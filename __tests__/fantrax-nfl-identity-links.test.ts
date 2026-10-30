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
  identityFindMany: vi.fn(), executeRaw: vi.fn(),
  info: vi.fn(), rosters: vi.fn(), standings: vi.fn(), players: vi.fn(), schedule: vi.fn(), draft: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {
  fantraxLeague: { findUnique: h.findUnique, updateMany: h.updateMany, upsert: h.upsert },
  fantraxUser: { upsert: h.userUpsert },
  playerIdentityMap: { findMany: h.identityFindMany },
  $executeRaw: h.executeRaw,
} }))
vi.mock('@/lib/league-import/fantrax/fantraxApi', async (original) => ({
  ...await original<object>(),
  getFantraxLeagueInfo: h.info, getFantraxTeamRosters: h.rosters,
  getFantraxStandings: h.standings, getFantraxPlayerIds: h.players,
  fetchFantraxScheduleWithScores: h.schedule, getFantraxDraftResults: h.draft,
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
