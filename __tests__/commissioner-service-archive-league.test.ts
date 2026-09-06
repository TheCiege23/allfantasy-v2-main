import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 🛑 `archiveLeague` USED `force: true`, WHICH SKIPPED THE ONLY GUARD IT NEEDED.
 *
 * Per docs/redraft/SEASON_ARCHIVE_ARBITRATION_REPORT.md: `archived` is already
 * a valid transition target from every other lifecycle state (see
 * `TRANSITIONS` in leagueLifecycleService.ts), so `force: true` bypassed
 * nothing meaningful about WHICH states can archive — its only real effect
 * was skipping `validateTransition`'s `current === next` idempotency check.
 * Calling archive twice re-wrote the same lifecycleState, wrote a fresh audit
 * row, and fired a fresh notification each time, non-transactionally.
 *
 * These tests pin: archiving still works from any state (that capability is
 * intentional, not the bug), the first call performs a real transition with
 * an audit log entry, and a second call on an already-archived league is a
 * true no-op — no second audit row, no second notification.
 */

const {
  isHeadCommissioner,
  findUniqueLeague,
  updateLeague,
  logAction,
  publishLeagueFanoutEvent,
} = vi.hoisted(() => ({
  isHeadCommissioner: vi.fn(),
  findUniqueLeague: vi.fn(),
  updateLeague: vi.fn(),
  logAction: vi.fn(),
  publishLeagueFanoutEvent: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: findUniqueLeague, update: updateLeague },
    $transaction: (cb: (tx: unknown) => unknown) =>
      cb({ league: { findUnique: findUniqueLeague, update: updateLeague } }),
  },
}))

vi.mock('@/server/services/permissionService', () => ({
  isHeadCommissioner,
  isElevatedCommissioner: vi.fn(),
  canDestructiveCommissionerAction: vi.fn(),
}))

vi.mock('@/server/services/auditService', () => ({ logAction }))

vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent }))

// Real implementations — these are the modules whose behavior we're
// verifying, not dependencies to fake out.
vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({ undoLastPick: vi.fn() }))
vi.mock('@/lib/waiver-wire/process-engine', () => ({ processWaiverClaimsForLeague: vi.fn() }))
vi.mock('@/server/services/standingsEngine', () => ({ recomputeStandingsForSeason: vi.fn() }))
vi.mock('@/lib/specialty-automation/orchestrator', () => ({ runSpecialtyAutomationOrchestrator: vi.fn() }))
vi.mock('@/server/services/leagueActionGate', () => ({ assertLeagueActionGate: vi.fn() }))

import { archiveLeague } from '@/server/services/commissionerService'

beforeEach(() => {
  vi.clearAllMocks()
  isHeadCommissioner.mockResolvedValue(true)
  logAction.mockResolvedValue(undefined)
  publishLeagueFanoutEvent.mockResolvedValue(undefined)
})

describe('archiveLeague', () => {
  it('rejects a non-head-commissioner', async () => {
    isHeadCommissioner.mockResolvedValueOnce(false)
    await expect(archiveLeague('league-1', 'user-1')).rejects.toMatchObject({ status: 403 })
    expect(findUniqueLeague).not.toHaveBeenCalled()
  })

  it('archives an in-season league (mid-season archiving remains allowed) and writes one audit entry', async () => {
    findUniqueLeague.mockResolvedValueOnce({ lifecycleState: 'in_season', lifecycleMetadata: null })
    updateLeague.mockResolvedValueOnce({})

    const result = await archiveLeague('league-1', 'user-1')

    expect(result).toEqual({ ok: true, alreadyArchived: false, lifecycleState: 'archived' })
    expect(updateLeague).toHaveBeenCalledTimes(1)
    expect(updateLeague).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'league-1' },
        data: expect.objectContaining({ lifecycleState: 'archived' }),
      }),
    )
    expect(logAction).toHaveBeenCalledTimes(1)
    // Fire-and-forget dynamic import (`void import(...).then(...)`, matching
    // the same pattern already used by `transitionLeagueState`) — give its
    // microtask a chance to run rather than asserting synchronously.
    await vi.waitFor(() => expect(publishLeagueFanoutEvent).toHaveBeenCalledTimes(1))
  })

  it('is idempotent — archiving an already-archived league writes no second audit row or notification', async () => {
    findUniqueLeague.mockResolvedValueOnce({ lifecycleState: 'archived', lifecycleMetadata: null })

    const result = await archiveLeague('league-1', 'user-1')

    expect(result).toEqual({ ok: true, alreadyArchived: true, lifecycleState: 'archived' })
    expect(updateLeague).not.toHaveBeenCalled()
    expect(logAction).not.toHaveBeenCalled()
    expect(publishLeagueFanoutEvent).not.toHaveBeenCalled()
  })
})
