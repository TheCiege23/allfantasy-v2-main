import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ league: vi.fn(), legality: vi.fn(), drops: vi.fn(), claims: vi.fn(), settings: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  league: { findFirst: h.league }, roster: { findFirst: async () => ({ id: 'r1', playerData: { players: ['drop-1'] }, faabRemaining: 0 }), findMany: async () => [] },
  leagueWaiverSettings: { findUnique: async () => ({}) }, waiverTransaction: { count: h.drops }, waiverClaim: { count: h.claims },
} }))
vi.mock('@/lib/waiver-wire/settings-service', () => ({ getEffectiveLeagueWaiverSettings: h.settings }))
vi.mock('@/lib/waiver-wire/current-nba-player-pool', () => ({ assertCurrentNbaWaiverPlayer: async () => {} }))
vi.mock('@/lib/league/commissioner-roster-lock', () => ({ isCommissionerRosterLocked: async () => false }))
vi.mock('@/lib/roster-legality/loadLegalityEvaluationContext', () => ({ evaluateLegalityForProjectedRoster: h.legality }))
vi.mock('@/lib/roster-lineup-engine/lineupLockService', () => ({ computePerPlayerKickoffLocks: () => ({ lockedPlayerIds: [] }) }))
import { previewWaiverClaimEligibility } from '@/lib/waiver-wire/transaction-eligibility'

const input = { leagueId: 'L', rosterId: 'r1', addPlayerId: 'add-2', dropPlayerId: 'drop-2' }
const projection = { playerData: { players: ['add-1', 'drop-2'] }, priorDrops: 1 }
beforeEach(() => {
  vi.resetAllMocks()
  h.league.mockResolvedValue({ id: 'L', sport: 'NFL', platform: 'manual', rosterSize: 2, settings: {}, lifecycleState: 'active' })
  h.settings.mockResolvedValue({ waiverType: 'fcfs', maxDropsPerWeek: 2 })
  h.drops.mockResolvedValue(0); h.claims.mockResolvedValue(0)
  h.legality.mockResolvedValue({ result: { blockingReasons: [], irViolations: [], taxiViolations: [], devyViolations: [] } })
})

describe('joint acquisition canonical simulation', () => {
  it('checks the next transaction against the preceding virtual roster', async () => {
    await expect(previewWaiverClaimEligibility(input, projection)).resolves.toBeUndefined()
    expect(h.legality).toHaveBeenCalledWith(expect.objectContaining({ playerData: projection.playerData }),
      expect.objectContaining({ players: ['add-1', 'add-2'] }))
  })
  it('shares remaining drop budget across every simulated transaction', async () => {
    h.settings.mockResolvedValue({ waiverType: 'fcfs', maxDropsPerWeek: 1 })
    await expect(previewWaiverClaimEligibility(input, projection)).rejects.toThrow('Weekly drop limit')
    h.settings.mockResolvedValue({ waiverType: 'fcfs', maxDropsPerWeek: 2 }); h.drops.mockResolvedValue(1)
    await expect(previewWaiverClaimEligibility(input, projection)).rejects.toThrow('Weekly drop limit')
  })
  it('cannot reuse a drop, add an already acquired player, or exceed shared capacity', async () => {
    await expect(previewWaiverClaimEligibility({ ...input, dropPlayerId: 'drop-1' }, projection)).rejects.toThrow('not on your roster')
    await expect(previewWaiverClaimEligibility({ ...input, addPlayerId: 'add-1' }, projection)).rejects.toThrow('already on your roster')
    await expect(previewWaiverClaimEligibility({ ...input, dropPlayerId: null }, projection)).rejects.toThrow('already at the limit')
  })
  it('requires a complete canonical legality result for every intermediate state', async () => {
    h.legality.mockResolvedValue(null)
    await expect(previewWaiverClaimEligibility(input, projection)).rejects.toThrow('unavailable')
    h.legality.mockResolvedValue({ result: { blockingReasons: [{ message: 'IR is ineligible' }], irViolations: [{}], taxiViolations: [], devyViolations: [] } })
    await expect(previewWaiverClaimEligibility(input, projection)).rejects.toThrow('IR, taxi, or devy')
  })
})
