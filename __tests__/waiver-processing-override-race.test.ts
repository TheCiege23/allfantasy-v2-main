// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ claimUpdate: vi.fn(), tx: vi.fn(), result: vi.fn(), locked: vi.fn(), hook: vi.fn(), runUpdate: vi.fn() }))
const metadata = { commissionerOverrides: { bypassInsufficientFaab: true } }
vi.mock('@/lib/prisma', () => ({ prisma: {
  league: { findUnique: async () => ({ id: 'L', rosterSize: 20, sport: 'NFL' }) },
  waiverClaim: { findMany: async () => [{ id: 'C', leagueId: 'L', rosterId: 'R', addPlayerId: 'new', dropPlayerId: null, faabBid: 0, priorityOrder: 1, status: 'pending', metadata, roster: { id: 'R', platformUserId: '', playerData: [], faabRemaining: 10, waiverPriority: 1 } }], update: h.claimUpdate },
  roster: { findMany: async () => [], update: vi.fn(), findUnique: async () => null },
  leagueTeam: { findMany: async () => [] }, waiverRun: { create: async () => ({ id: 'run' }), update: h.runUpdate },
  waiverTransaction: { create: vi.fn() }, waiverResult: { createMany: h.result }, $transaction: h.tx,
} }))
vi.mock('@/lib/waiver-wire/settings-service', () => ({ getEffectiveLeagueWaiverSettings: async () => ({ waiverType: 'standard', waiverEngineConfig: {} }) }))
vi.mock('@/lib/waiver-wire/waiver-state-service', () => ({ getLeagueWaiverState: async () => null, upsertLeagueWaiverStateAfterRun: async () => {} }))
vi.mock('@/lib/waiver-wire/run-hooks', () => ({ onWaiverRunComplete: h.hook }))
vi.mock('@/lib/specialty-league/registry', () => ({ getSpecialtySpecByVariant: () => null }))
vi.mock('@/lib/survivor/SurvivorEffectEngine', () => ({ isWaiverFrozenForRoster: async () => false }))
vi.mock('@/lib/league/commissioner-roster-lock', () => ({ isCommissionerRosterLocked: h.locked }))
vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({ recordProductEvent: async () => {} }))
vi.mock('@/lib/ai-learning-system/recordEvent', () => ({ recordAfLearningEvent: vi.fn() }))
vi.mock('@/lib/ai-learning-system/resolveLeagueSport', () => ({ resolveLeagueSport: async () => 'NFL' }))
import { processWaiverClaimsForLeague } from '@/lib/waiver-wire/process-engine'
const conflict = { code: 'P2025', meta: { modelName: 'WaiverClaim' } }
beforeEach(() => { vi.clearAllMocks(); h.locked.mockResolvedValue(false); h.claimUpdate.mockReturnValue({}); h.tx.mockResolvedValue([]); h.runUpdate.mockResolvedValue({}); h.hook.mockResolvedValue(undefined) })
it('guards the claim snapshot inside the award transaction and skips a stale award', async () => {
  h.tx.mockRejectedValue(conflict)
  expect(await processWaiverClaimsForLeague('L')).toEqual([])
  expect(h.claimUpdate.mock.calls[0][0].where).toEqual({ id: 'C', leagueId: 'L', status: 'pending', metadata: { equals: metadata } })
  expect(h.result).not.toHaveBeenCalled()
  expect(h.runUpdate).toHaveBeenCalled()
})
it('does not replace changed metadata with a stale failure outcome', async () => {
  h.locked.mockResolvedValue(true)
  h.claimUpdate.mockRejectedValue(conflict)
  expect(await processWaiverClaimsForLeague('L')).toEqual([])
  expect(h.claimUpdate.mock.calls[0][0].where.metadata.equals).toEqual(metadata)
  expect(h.tx).not.toHaveBeenCalled()
  expect(h.result).not.toHaveBeenCalled()
})
it('propagates unrelated transaction failures', async () => {
  const error = { code: 'P2025', meta: { modelName: 'Roster' } }
  h.tx.mockRejectedValue(error)
  await expect(processWaiverClaimsForLeague('L')).rejects.toEqual(error)
})
it('continues to award an unchanged pending claim', async () => {
  const results = await processWaiverClaimsForLeague('L')
  expect(results).toHaveLength(1)
  expect(results[0].success).toBe(true)
  expect(h.result).toHaveBeenCalledTimes(1)
})
