// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({
  db: { league: { findFirst: vi.fn() }, redraftMatchup: { findFirst: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
    redraftSeason: { findFirst: vi.fn() }, redraftRosterPlayer: { findMany: vi.fn() }, roster: { findMany: vi.fn() }, afRosterLineupAssignment: { findMany: vi.fn() }, leaguePlayerWeeklyScore: { deleteMany: vi.fn(), createMany: vi.fn() }, $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)) },
  bonus: vi.fn(), lock: vi.fn(), emit: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: h.db }))
vi.mock('@/lib/devy/scoringEligibilityEngine', () => ({ leagueUsesDevyEngine: vi.fn(async () => false) }))
vi.mock('@/lib/c2c/scoringEngine', () => ({ leagueUsesC2CEngine: vi.fn(async () => false) }))
vi.mock('@/lib/events', () => ({ getPlatformEvents: () => ({ emit: h.emit }), EVENT: {} }))
vi.mock('@/lib/sports-evidence/gates', () => ({ isSportsDataEnabled: () => false }))
vi.mock('@/lib/zombie/beta2025ItemService', () => ({ loadBetaItemScoreReceipt: h.bonus, lockItemLeague: h.lock,
  itemTransaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(h.db) }))
import { updateMatchupScores } from '@/lib/redraft/scoringEngine'
beforeEach(() => {
  vi.resetAllMocks()
  h.db.league.findFirst.mockResolvedValue({ sport: 'NFL', leagueType: 'zombie', platform: 'manual', settings: {} })
  h.db.redraftMatchup.findFirst.mockResolvedValue({ id: 'M', leagueId: 'L', seasonId: 'S', week: 1, homeRosterId: 'A', awayRosterId: 'B', homeRoster: {}, awayRoster: {}, homeScore: 0, awayScore: 0 })
  h.db.redraftMatchup.findUniqueOrThrow.mockResolvedValue({ homeRosterId: 'A', awayRosterId: 'C', lineupSnapshots: null })
  h.db.redraftSeason.findFirst.mockResolvedValue({ id: 'S', season: 2026, sport: 'NFL' })
  h.db.redraftRosterPlayer.findMany.mockResolvedValue([]); h.db.roster.findMany.mockResolvedValue([]); h.db.afRosterLineupAssignment.findMany.mockResolvedValue([])
})
it('refuses to write scores computed for the old opponents after an ambush commits', async () => {
  await expect(updateMatchupScores('M')).rejects.toThrow('ZOMBIE_MATCHUP_CHANGED_RETRY')
  expect(h.lock).toHaveBeenCalledWith(h.db, 'L')
  expect(h.bonus).not.toHaveBeenCalled(); expect(h.db.redraftMatchup.update).not.toHaveBeenCalled(); expect(h.emit).not.toHaveBeenCalled()
})
it('rebuilds the new pair on retry and reads its current receipt while holding the league lock', async () => {
  h.db.redraftMatchup.findFirst.mockResolvedValue({ id: 'M', leagueId: 'L', seasonId: 'S', week: 1, homeRosterId: 'A', awayRosterId: 'C', homeRoster: {}, awayRoster: {}, homeScore: 0, awayScore: 0 })
  h.bonus.mockResolvedValue({ policy: 'beta_2025', home: { bonus: 10 }, away: { bonus: 5 } })
  await updateMatchupScores('M')
  expect(h.bonus).toHaveBeenCalledWith(expect.objectContaining({ homeRosterId: 'A', awayRosterId: 'C' }), h.db)
  expect(h.db.redraftMatchup.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ homeScore: 10, awayScore: 5 }) }))
})
