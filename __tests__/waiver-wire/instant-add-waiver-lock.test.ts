// @vitest-environment node
/**
 * An instant free-agent add takes the same per-league lock as a waiver run (leagueWaiverLock.ts), so
 * neither can put a player on a roster while the other is deciding who he belongs to.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  locks: new Map<string, string>(),
  lockError: false,
  eligibility: vi.fn(async () => undefined),
  tx: vi.fn(async () => ({ ok: true })),
}))

vi.mock('@/lib/automation/locks', () => ({
  acquireAutomationLock: vi.fn(async (key: string, { owner }: { owner: string }) => {
    if (h.lockError) return { ok: false, reason: 'Postgres lock error: table missing' }
    const held = h.locks.get(key)
    if (held && held !== owner) return { ok: false, reason: 'Lock held (postgres)' }
    h.locks.set(key, owner)
    return { ok: true, backend: 'postgres' }
  }),
  releaseAutomationLock: vi.fn(async (key: string, owner: string) => {
    if (h.locks.get(key) === owner) h.locks.delete(key)
  }),
}))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: async () => ({ sport: 'NFL' }) }, $transaction: h.tx } }))
vi.mock('@/lib/waiver-wire/transaction-eligibility', () => ({ assertWaiverClaimEligibility: h.eligibility }))
vi.mock('@/lib/survivor/survivorStealThreeWaivers', () => ({ assertStealThreeWaiverHoldCleared: vi.fn() }))
vi.mock('@/lib/league-runtime/redraftRosterMoveSync', () => ({ applyRedraftRosterMoves: vi.fn() }))

import { executeImmediateAddDrop, WAIVER_RUN_IN_PROGRESS_MESSAGE } from '@/lib/waiver-wire/free-agent-service'
import { leagueWaiverLockKey } from '@/lib/waiver-wire/leagueWaiverLock'

beforeEach(() => {
  vi.clearAllMocks()
  h.locks = new Map()
  h.lockError = false
})

describe('instant free-agent add under the league waiver lock', () => {
  it('refuses with "try again" while a waiver run holds the league, and checks or writes nothing', async () => {
    vi.useFakeTimers()
    h.locks.set(leagueWaiverLockKey('L'), 'waiver-process:run-1')
    const attempt = executeImmediateAddDrop('L', 'R1', { addPlayerId: 'p9' })
    const settled = expect(attempt).rejects.toThrow(WAIVER_RUN_IN_PROGRESS_MESSAGE)
    await vi.runAllTimersAsync()
    await settled
    expect(h.eligibility).not.toHaveBeenCalled()
    expect(h.tx).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('checks availability and writes inside the lock, then releases it', async () => {
    let heldDuringCheck = false
    h.eligibility.mockImplementationOnce(async () => {
      heldDuringCheck = h.locks.has(leagueWaiverLockKey('L'))
    })
    await executeImmediateAddDrop('L', 'R1', { addPlayerId: 'p9' })
    expect(heldDuringCheck).toBe(true)
    expect(h.tx).toHaveBeenCalledTimes(1)
    expect(h.locks.size).toBe(0)
  })

  it('a lock table that cannot be read does not block adds', async () => {
    h.lockError = true
    await executeImmediateAddDrop('L', 'R1', { addPlayerId: 'p9' })
    expect(h.tx).toHaveBeenCalledTimes(1)
  })
})
