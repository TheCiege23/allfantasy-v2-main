// @vitest-environment node
/**
 * Fantrax DraftFact picks are named and graded in the imported draft report.
 *
 * 🛑 WHAT WAS WRONG: `resolveSleeperIds` answered only `sleeper` and `espn`, so every Fantrax pick
 * had no Sleeper id, no points and no grade; and `resolveNames` read `PlayerProviderIdentity`, which
 * nothing fills for Fantrax, so every pick was "Player". Fantrax ids live on
 * `PlayerIdentityMap.fantraxId` (NFL rows linked by the import since `linkNflFantraxIdentities`),
 * and those NFL rows carry the Sleeper id the season board is keyed on.
 *
 * ⚠ The season board is Sleeper's NFL stats. A non-NFL league is named but never graded against it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  league: vi.fn(), facts: vi.fn(), teams: vi.fn(), identities: vi.fn(), providerNames: vi.fn(), board: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {
  league: { findUnique: m.league },
  draftFact: { findMany: m.facts },
  leagueTeam: { findMany: m.teams },
  playerIdentityMap: { findMany: m.identities },
  playerProviderIdentity: { findMany: m.providerNames },
} }))
vi.mock('@/lib/sports-data/sleeperMarketService', async (original) => ({
  ...await original<object>(),
  getSeasonStatsBoard: m.board,
}))
import { buildImportedDraftReport } from '@/lib/draft-intel/importedDraftReport'

const pick = (round: number, pickNumber: number, playerId: string, managerId: string) =>
  ({ season: 2024, round, pickNumber, playerId, managerId })

beforeEach(() => {
  vi.resetAllMocks()
  m.league.mockResolvedValue({ id: 'L', platform: 'fantrax', sport: 'NFL', settings: {}, leagueType: 'redraft' })
  m.facts.mockResolvedValue([
    pick(1, 1, 'fxA', '1'), pick(1, 2, 'fxB', '2'), pick(2, 3, 'fxC', '2'), pick(2, 4, 'fxD', '1'),
  ])
  m.teams.mockResolvedValue([{ externalId: '1', teamName: 'T1', ownerName: 'O1', avatarUrl: null }, { externalId: '2', teamName: 'T2', ownerName: 'O2', avatarUrl: null }])
  m.identities.mockResolvedValue([
    { fantraxId: 'fxA', canonicalName: 'Alpha Back', position: 'RB', currentTeam: 'KC', sleeperId: 's1', rollingInsightsId: null, cfbdId: null },
    { fantraxId: 'fxB', canonicalName: 'Bravo Wide', position: 'WR', currentTeam: 'BUF', sleeperId: 's2', rollingInsightsId: null, cfbdId: null },
    { fantraxId: 'fxC', canonicalName: 'Charlie End', position: 'TE', currentTeam: 'MIA', sleeperId: 's3', rollingInsightsId: null, cfbdId: null },
    { fantraxId: 'fxD', canonicalName: 'Delta Arm', position: 'QB', currentTeam: 'DAL', sleeperId: 's4', rollingInsightsId: null, cfbdId: null },
  ])
  /* A colliding name under another provider's id space must never be used for a Fantrax id. */
  m.providerNames.mockResolvedValue([{ providerPlayerId: 'fxA', displayName: 'Wrong Provider Person' }])
  m.board.mockResolvedValue({ version: 1, season: '2024', players: {
    s1: { playerId: 's1', name: 'x', position: 'RB', team: 'KC', stats: { pts_ppr: 300 } },
    s2: { playerId: 's2', name: 'x', position: 'WR', team: 'BUF', stats: { pts_ppr: 100 } },
    s3: { playerId: 's3', name: 'x', position: 'TE', team: 'MIA', stats: { pts_ppr: 250 } },
    s4: { playerId: 's4', name: 'x', position: 'QB', team: 'DAL', stats: { pts_ppr: 50 } },
  } })
})

describe('Fantrax imported draft report', () => {
  it('names and grades NFL Fantrax picks through PlayerIdentityMap.fantraxId', async () => {
    const report = await buildImportedDraftReport('L')
    expect(report).not.toBeNull()
    const [season] = report!.seasons
    expect(season!.gradedPicks).toBe(4)
    const named = [...season!.steals, ...season!.busts].map((p) => p.playerName)
    expect(named.length).toBeGreaterThan(0)
    for (const name of named) expect(['Alpha Back', 'Bravo Wide', 'Charlie End', 'Delta Arm']).toContain(name)
    expect(named).not.toContain('Wrong Provider Person')
    expect(report!.missing.join(' ')).not.toMatch(/not yet linked/)
    expect(m.identities.mock.calls[0][0].where).toMatchObject({ sport: 'NFL', fantraxId: { in: ['fxA', 'fxB', 'fxC', 'fxD'] } })
  })

  it('never grades a non-NFL Fantrax league against the NFL board', async () => {
    m.league.mockResolvedValue({ id: 'L', platform: 'fantrax', sport: 'MLB', settings: {}, leagueType: 'redraft' })
    const report = await buildImportedDraftReport('L')
    expect(report).toBeNull()
    expect(m.board).not.toHaveBeenCalled()
  })
})

describe('ESPN imported draft names are scoped to the issuing provider', () => {
  it('asks PlayerProviderIdentity for ESPN ids under provider espn and the league sport only', async () => {
    m.league.mockResolvedValue({ id: 'L', platform: 'espn', sport: 'NFL', settings: {}, leagueType: 'redraft' })
    m.identities.mockResolvedValue([])
    m.providerNames.mockResolvedValue([])
    await buildImportedDraftReport('L')
    expect(m.providerNames).toHaveBeenCalled()
    /* 12,074 provider ids exist under two or more providers: an unscoped read names a stranger. */
    expect(m.providerNames.mock.calls[0][0].where).toMatchObject({
      provider: 'espn',
      providerPlayerId: { in: ['fxA', 'fxB', 'fxC', 'fxD'] },
      sportKey: { equals: 'NFL', mode: 'insensitive' },
    })
  })
})
