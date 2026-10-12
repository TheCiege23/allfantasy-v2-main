import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  config: vi.fn(), league: vi.fn(), roster: vi.fn(), team: vi.fn(), cycle: vi.fn(), jury: vi.fn(), audit: vi.fn(), score: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: {
  league: { findUnique: mocks.league }, roster: { findMany: mocks.roster }, leagueTeam: { findMany: mocks.team },
  bigBrotherCycle: { findMany: mocks.cycle }, bigBrotherJuryMember: { findMany: mocks.jury },
  bigBrotherAuditLog: { findFirst: mocks.audit }, teamWeekResult: { findMany: mocks.score },
} }))
vi.mock('@/lib/big-brother/BigBrotherLeagueConfig', () => ({ getBigBrotherConfig: mocks.config }))
import { getBigBrotherStandings } from '@/lib/big-brother/BigBrotherStandingsService'
beforeEach(() => {
  vi.resetAllMocks()
  mocks.config.mockResolvedValue({ configId: 'cfg', finaleFormat: 'final_2' })
  mocks.league.mockResolvedValue({ season: 2026 })
  mocks.roster.mockResolvedValue([{ id: 'r1', platformUserId: 'user' }, { id: 'r2', platformUserId: 'orphan-2' }])
  mocks.team.mockResolvedValue([{ legacyRosterId: 'r1', platformUserId: 'user', claimedByUserId: 'user', teamName: 'Real team', ownerName: 'Manager' },
    { legacyRosterId: null, platformUserId: 'orphan-2', claimedByUserId: null, teamName: 'Open Team 2', ownerName: '' }])
  mocks.cycle.mockResolvedValue([]); mocks.jury.mockResolvedValue([]); mocks.audit.mockResolvedValue(null); mocks.score.mockResolvedValue([])
})
describe('Big Brother standings source contract', () => {
  it('reads the current season, final scores, public cycle results and published tally only', async () => {
    const result = await getBigBrotherStandings('l', 'user')
    expect(result?.rows.map(r => r.teamName)).toEqual(['Open Team 2', 'Real team'])
    expect(result?.viewerRosterId).toBe('r1')
    expect(mocks.score.mock.calls[0][0].where).toEqual({ leagueId: 'l', season: 2026, status: 'final' })
    expect(mocks.cycle.mock.calls[0][0].where).toEqual({ leagueId: 'l', configId: 'cfg' })
    expect(mocks.cycle.mock.calls[0][0].select).not.toHaveProperty('votes')
    expect(mocks.audit.mock.calls[0][0].where.eventType).toBe('finale_vote')
  })
  it('does not mistake historic or missing scores for current actual zero', async () => {
    mocks.score.mockResolvedValue([{ season: 2025, rosterId: 'r1', week: 1, totalPoints: 800 }, { season: 2026, rosterId: 'r2', week: 1, totalPoints: 0 }])
    const result = await getBigBrotherStandings('l', 'user')
    expect(result?.rows.find(r => r.rosterId === 'r1')?.processedPoints).toBeNull()
    expect(result?.rows.find(r => r.rosterId === 'r2')?.processedPoints).toBe(0)
  })
  it('prefers explicit roster links over ambiguous owner identities', async () => {
    mocks.team.mockResolvedValue([{ legacyRosterId: 'r1', platformUserId: 'different', teamName: 'Linked team' },
      { legacyRosterId: null, platformUserId: 'user', teamName: 'Wrong team' }])
    expect((await getBigBrotherStandings('l', 'user'))?.rows.find(r => r.rosterId === 'r1')?.teamName).toBe('Linked team')
  })
  it('highlights a claim-only viewer without choosing another managerâ€™s roster', async () => {
    mocks.team.mockResolvedValue([{ legacyRosterId: 'r2', claimedByUserId: 'claim-user', platformUserId: 'orphan-2', teamName: 'Claimed team' }])
    expect((await getBigBrotherStandings('l', 'claim-user'))?.viewerRosterId).toBe('r2')
    expect((await getBigBrotherStandings('l', 'spectator'))?.viewerRosterId).toBeNull()
  })
  it('prefers the claimed roster link over a stale platform identity for viewer highlighting', async () => {
    mocks.team.mockResolvedValue([{ legacyRosterId: 'r2', claimedByUserId: 'claim-user', platformUserId: 'user', teamName: 'Claimed team' }])
    expect((await getBigBrotherStandings('l', 'claim-user'))?.viewerRosterId).toBe('r2')
  })
  it('does not read game data for non-Big-Brother leagues', async () => {
    mocks.config.mockResolvedValue(null)
    expect(await getBigBrotherStandings('l', 'user')).toBeNull()
    expect(mocks.cycle).not.toHaveBeenCalled()
  })
})
