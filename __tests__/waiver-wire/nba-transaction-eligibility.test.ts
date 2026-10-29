// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ league: vi.fn(), pool: vi.fn(), legality: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  league: { findFirst: h.league },
  roster: { findFirst: async () => ({ id: 'r1', playerData: [], faabRemaining: 100 }), findMany: async () => [] },
  leagueWaiverSettings: { findUnique: async () => ({}) },
  sportsPlayer: { findMany: async () => [{ name: 'Nikola Jokic', externalId: '114', source: 'rolling_insights', status: 'ACT', team: 'DEN', fetchedAt: new Date(), expiresAt: new Date(Date.now() + 86400000) }] },
} }))
vi.mock('@/lib/sport-teams/SportPlayerPoolResolver', () => ({ getPlayerPoolForLeague: h.pool }))
vi.mock('@/lib/waiver-wire/settings-service', () => ({ getEffectiveLeagueWaiverSettings: async () => ({ waiverType: 'faab' }) }))
vi.mock('@/lib/league/commissioner-roster-lock', () => ({ isCommissionerRosterLocked: async () => false }))
vi.mock('@/lib/roster-legality/loadLegalityEvaluationContext', () => ({ evaluateLegalityForProjectedRoster: h.legality }))
vi.mock('@/lib/roster-lineup-engine/lineupLockService', () => ({ computePerPlayerKickoffLocks: () => ({ lockedPlayerIds: [] }) }))
import { assertWaiverClaimEligibility } from '@/lib/waiver-wire/transaction-eligibility'
beforeEach(() => {
  vi.clearAllMocks()
  h.league.mockResolvedValue({ id: 'nba', sport: 'NBA', leagueVariant: 'redraft', isDynasty: false, rosterSize: 10, lockAllMoves: false, lifecycleState: 'setup' })
  h.pool.mockResolvedValue([
    { full_name: 'A.J. Hammons', position: 'C', player_id: 'old', external_source_id: '563' },
    { full_name: 'Nikola Jokic', position: 'C', player_id: 'current', external_source_id: '114' },
  ])
  h.legality.mockResolvedValue(null)
})
describe('authoritative NBA waiver transaction gate', () => {
  it('rejects a retired profile even when submitted directly rather than selected in the UI', async () => {
    await expect(assertWaiverClaimEligibility({ leagueId: 'nba', rosterId: 'r1', addPlayerId: 'old' })).rejects.toThrow('verified current NBA roster')
    expect(h.legality).not.toHaveBeenCalled()
  })
  it.each(['current', '114'])('retains existing roster-legality checks for verified id %s', async addPlayerId => {
    await expect(assertWaiverClaimEligibility({ leagueId: 'nba', rosterId: 'r1', addPlayerId })).resolves.toBeUndefined()
    expect(h.legality).toHaveBeenCalledOnce()
  })
  it('does not change non-NBA transaction eligibility', async () => {
    h.league.mockResolvedValue({ ...(await h.league()), sport: 'NFL' })
    await expect(assertWaiverClaimEligibility({ leagueId: 'nba', rosterId: 'r1', addPlayerId: 'football-player' })).resolves.toBeUndefined()
    expect(h.pool).not.toHaveBeenCalled()
  })
})
