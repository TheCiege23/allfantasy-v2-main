/**
 * Route wiring for the post-draft roster lock:
 * - add-drop names its move as a free-agent pickup and answers the lock with 423 + `roster_locked_post_draft`;
 * - a claim submitted during the lock is accepted and QUEUED — an FCFS league does not process it on the spot;
 * - a trade-engine throw carrying the lock code is answered with that code, not a bare 400.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
// These tests isolate their own waiver/lifecycle behavior; the pre-draft policy has its own route tests.
vi.mock('@/lib/waiver-wire/season-phase-gate', () => ({
  loadWaiverPhasePolicy: async () => ({ phase: 'regular', claimsAllowed: true, immediateAddsAllowed: true, firstComeAdds: false, code: null, reason: null }),
  loadWaiverRunPhaseGate: async () => () => null,
}))


const m = vi.hoisted(() => ({
  gate: vi.fn(),
  executeAdd: vi.fn(),
  createClaim: vi.fn(),
  processClaims: vi.fn(),
  effective: vi.fn(),
  prisma: {
    league: { findUnique: vi.fn(), findFirst: vi.fn() },
    roster: { findFirst: vi.fn() },
    leagueTeam: { findFirst: vi.fn() },
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn().mockResolvedValue({ user: { id: 'u1' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/server/services/leagueActionGate', () => ({ assertLeagueActionGate: m.gate }))
vi.mock('@/lib/roster-legality/rosterTransactionGates', () => ({ assertRosterTransactionsAllowed: vi.fn().mockResolvedValue({ ok: true }) }))
vi.mock('@/server/services/auditService', () => ({ logAction: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/dashboard/intelligence-events', () => ({ invalidateIntelligence: vi.fn() }))
vi.mock('@/lib/league/write-authority-server', () => ({ resolveWriteAuthorityEnvelope: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/waiver-wire/free-agent-service', () => ({ executeImmediateAddDrop: m.executeAdd }))
vi.mock('@/lib/waiver-wire/daily-schedule-gate', () => ({
  loadDailyTransactionPolicy: vi.fn().mockResolvedValue(null),
  dailyScheduleImmediateAddRefusal: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/waiver-wire', () => ({
  createClaim: m.createClaim,
  getClaimsByRoster: vi.fn().mockResolvedValue([]),
  getEffectiveLeagueWaiverSettings: m.effective,
  getPendingClaims: vi.fn().mockResolvedValue([]),
  getProcessedClaimsAndTransactions: vi.fn().mockResolvedValue({ claims: [], transactions: [] }),
}))
vi.mock('@/lib/waiver-wire/process-engine', () => ({ processWaiverClaimsForLeague: m.processClaims }))
vi.mock('@/lib/league/permissions', () => ({ getLeagueRole: vi.fn().mockResolvedValue('member') }))
vi.mock('@/lib/ai/action-validation', () => ({ validateAiActionExecution: vi.fn(() => ({ ok: true })) }))
vi.mock('@/lib/waiver-wire/commissioner-claim-override', () => ({ mergeCommissionerOverrides: vi.fn((x) => x ?? {}) }))
vi.mock('@/lib/sports-evidence/gates', () => ({ isSportsDataEnabled: vi.fn(() => false) }))
vi.mock('@/lib/league-notifications/realtimeHint', () => ({ publishLeagueRealtimeHint: vi.fn() }))

import { POST as addDrop } from '@/app/api/waiver-wire/leagues/[leagueId]/add-drop/route'
import { POST as submitClaim } from '@/app/api/waiver-wire/leagues/[leagueId]/claims/route'
import { postDraftLockErrorResponse, POST_DRAFT_ROSTER_LOCK_CODE } from '@/lib/league/postDraftRosterLock'

const LOCK_REFUSAL = {
  ok: false,
  err: {
    status: 423,
    code: 'roster_locked_post_draft',
    error: 'Rosters are locked after the draft. Free-agent pickups open after the first waiver run or when week 1 starts.',
    unlocksAt: '2026-09-11T00:20:00.000Z',
  },
}
const params = { params: Promise.resolve({ leagueId: 'L1' }) }
const body = (b: unknown) => ({ json: async () => b }) as never

beforeEach(() => {
  vi.clearAllMocks()
  m.prisma.roster.findFirst.mockResolvedValue({ id: 'R1' })
  m.prisma.league.findUnique.mockResolvedValue({ leagueVariant: null })
  m.effective.mockResolvedValue({ normalizedWaiverType: 'fcfs', instantFaAfterClear: false })
  m.executeAdd.mockResolvedValue({ transaction: { id: 'T1' } })
  m.createClaim.mockResolvedValue({ id: 'C1' })
  m.processClaims.mockResolvedValue([])
})

describe('add-drop during the post-draft lock', () => {
  it('asks the gate about a FREE-AGENT PICKUP, not a claim', async () => {
    m.gate.mockResolvedValue({ ok: true })
    await addDrop(body({ addPlayerId: 'p1' }), params)
    expect(m.gate).toHaveBeenCalledWith('L1', 'u1', 'waiver_claim_submit', { rosterMove: 'free_agent_pickup' })
  })

  it('refuses with 423 roster_locked_post_draft and the unlock time, and moves no player', async () => {
    m.gate.mockResolvedValue(LOCK_REFUSAL)
    const res = await addDrop(body({ addPlayerId: 'p1' }), params)
    expect(res.status).toBe(423)
    expect(await res.json()).toEqual({
      ok: false,
      code: 'roster_locked_post_draft',
      error: LOCK_REFUSAL.err.error,
      unlocksAt: '2026-09-11T00:20:00.000Z',
    })
    expect(m.executeAdd).not.toHaveBeenCalled()
  })
})

describe('waiver claims during the post-draft lock', () => {
  it('accepts the claim and QUEUES it — an FCFS league does not process it immediately', async () => {
    m.gate.mockResolvedValue({ ok: true, postDraftLock: { locked: true, unlocksAt: new Date('2026-09-11T00:20:00Z') } })
    const res = await submitClaim(body({ addPlayerId: 'p1' }) as never, params)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(m.createClaim).toHaveBeenCalledTimes(1)
    expect(m.processClaims).not.toHaveBeenCalled()
    expect(json.queuedForFirstWaiverRun).toBe(true)
    expect(json.fcfsProcessedImmediately).toBe(false)
  })

  it('outside the lock an FCFS claim still processes immediately (control)', async () => {
    m.gate.mockResolvedValue({ ok: true })
    const res = await submitClaim(body({ addPlayerId: 'p1' }) as never, params)
    const json = await res.json()
    expect(m.processClaims).toHaveBeenCalledWith('L1', { runType: 'fcfs_immediate', processedByUserId: 'u1' })
    expect(json.fcfsProcessedImmediately).toBe(true)
    expect(json.queuedForFirstWaiverRun).toBeUndefined()
  })
})

describe('trade routes', () => {
  it('a trade-engine throw carrying the lock code maps to its code and status', () => {
    const e = Object.assign(new Error('Rosters are locked after the draft.'), { code: POST_DRAFT_ROSTER_LOCK_CODE, status: 423 })
    expect(postDraftLockErrorResponse(e)).toEqual({
      body: { error: 'Rosters are locked after the draft.', code: 'roster_locked_post_draft' },
      status: 423,
    })
    expect(postDraftLockErrorResponse(new Error('Trade deadline has passed'))).toBeNull()
    expect(postDraftLockErrorResponse(Object.assign(new Error('x'), { code: 'P2002' }))).toBeNull()
  })
})
