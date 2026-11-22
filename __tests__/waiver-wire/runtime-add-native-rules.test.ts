// @vitest-environment node
/**
 * `/api/redraft/waiver-runtime` action `add_free_agent` applies the native add/drop's rules
 * (lib/waiver-wire/immediateAddGate.ts), and refuses with the same code, status and message.
 *
 * Before, any rostered member could instant-add there with Best Ball free agency off, from a chopped Guilly
 * team, or a player still held after a chop. Each case is run through BOTH routes on the same rule state:
 * the runtime must answer exactly what the native route answers, and must not reach the add.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  prisma: {
    roster: { findFirst: vi.fn() },
    redraftRoster: { findFirst: vi.fn() },
    redraftSeason: { findUnique: vi.fn() },
    league: { findUnique: vi.fn() },
    waiverClaim: { findFirst: vi.fn() },
  },
  phase: vi.fn(),
  gate: vi.fn(),
  legality: vi.fn(),
  effective: vi.fn(),
  hold: vi.fn(),
  eligibility: vi.fn(),
  executeAdd: vi.fn(),
  runtimeAdd: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn().mockResolvedValue({ user: { id: 'u1' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/team-coowners/access', () => ({ acceptedCoOwnerRosterId: vi.fn(async () => null), isAcceptedCoOwnerForRedraftRoster: vi.fn(async () => false) }))
vi.mock('@/lib/league/league-access', () => ({
  assertLeagueMember: vi.fn(async () => ({ ok: true })),
  assertLeagueCommissioner: vi.fn(async () => ({ ok: false, status: 403 })),
}))
// The rule sources. Each test sets one of them; the gate itself is real.
vi.mock('@/lib/waiver-wire/season-phase-gate', () => ({ loadWaiverPhasePolicy: m.phase }))
vi.mock('@/server/services/leagueActionGate', () => ({ assertLeagueActionGate: m.gate }))
vi.mock('@/lib/roster-legality/rosterTransactionGates', () => ({ assertRosterTransactionsAllowed: m.legality }))
vi.mock('@/lib/waiver-wire', () => ({ getEffectiveLeagueWaiverSettings: m.effective }))
vi.mock('@/lib/waiver-wire/daily-schedule-gate', () => ({
  loadDailyTransactionPolicy: vi.fn(async () => null),
  dailyScheduleImmediateAddRefusal: vi.fn(async () => null),
  dailyUnlockImmediateAddRefusal: vi.fn(async () => null),
  PENDING_CLAIM_ON_PLAYER_MESSAGE: 'pending claim',
}))
vi.mock('@/lib/waiver-wire/dropped-player-waivers', () => ({
  DROPPED_PLAYER_ON_WAIVERS_MESSAGE: 'This player was dropped recently and is on waivers. Claim him through waivers.',
  loadDroppedPlayerHoldPolicy: vi.fn(async () => ({})),
  loadDroppedPlayerHold: m.hold,
}))
vi.mock('@/lib/waiver-wire/after-run-free-agency', () => ({ loadAfterRunFreeAgencyState: vi.fn(), afterRunRefusalMessage: vi.fn(() => null) }))
vi.mock('@/lib/waiver-wire/transaction-eligibility', () => ({ assertWaiverClaimEligibility: m.eligibility }))
vi.mock('@/lib/waiver-wire/free-agent-service', () => ({ executeImmediateAddDrop: m.executeAdd }))
vi.mock('@/lib/waiver-wire/lineup-fill-warning', () => ({ LINEUP_WARNING_CODE: 'LINEUP_WARNING', lineupWarningConfirmed: () => true, loadLineupFillWarning: vi.fn(async () => null) }))
vi.mock('@/server/services/auditService', () => ({ logAction: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/dashboard/intelligence-events', () => ({ invalidateIntelligence: vi.fn() }))
vi.mock('@/lib/league/write-authority-server', () => ({ resolveWriteAuthorityEnvelope: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/waiver-runtime', () => ({
  addNflRedraftFreeAgent: m.runtimeAdd,
  cancelNflRedraftWaiverClaim: vi.fn(),
  editNflRedraftWaiverClaim: vi.fn(),
  processNflRedraftWaiverWindow: vi.fn(),
  resolveNflRedraftWaiverRuntime: vi.fn(),
  submitNflRedraftWaiverClaim: vi.fn(),
}))

import { POST as nativePost } from '@/app/api/waiver-wire/leagues/[leagueId]/add-drop/route'
import { POST as runtimePost } from '@/app/api/redraft/waiver-runtime/route'

type Answer = { status: number; body: { ok?: boolean; code?: string; error?: string } }

async function native(): Promise<Answer> {
  const req = new Request('http://x/api', { method: 'POST', body: JSON.stringify({ addPlayerId: 'star' }) }) as never
  const res = await nativePost(req, { params: Promise.resolve({ leagueId: 'L' }) })
  return { status: res.status, body: await res.json() }
}
async function runtime(extra: Record<string, unknown> = {}): Promise<Answer> {
  const req = new Request('http://x/api', {
    method: 'POST',
    body: JSON.stringify({ action: 'add_free_agent', leagueId: 'L', seasonId: 's1', rosterId: 'rr1', addPlayerId: 'star', ...extra }),
  })
  const res = await runtimePost(req)
  return { status: res.status, body: await res.json() }
}

const pick = (a: Answer) => ({ status: a.status, ok: a.body.ok, code: a.body.code, error: a.body.error })

beforeEach(() => {
  vi.clearAllMocks()
  m.prisma.roster.findFirst.mockResolvedValue({ id: 'g1' })
  m.prisma.redraftRoster.findFirst.mockResolvedValue({ id: 'rr1', ownerId: 'u1', seasonId: 's1', leagueId: 'L' })
  m.prisma.waiverClaim.findFirst.mockResolvedValue(null)
  m.phase.mockResolvedValue({ immediateAddsAllowed: true, firstComeAdds: false, reason: null, code: null })
  m.gate.mockResolvedValue({ ok: true })
  m.legality.mockResolvedValue({ ok: true })
  m.effective.mockResolvedValue({ normalizedWaiverType: 'faab', instantFaAfterClear: true, freeAgentUnlockBehavior: 'after_waiver_run' })
  m.hold.mockResolvedValue(null)
  m.eligibility.mockResolvedValue(undefined)
  m.executeAdd.mockResolvedValue({ ok: true, transaction: { id: 't1' }, rosterId: 'g1', rosterPlayerIds: [] })
  m.runtimeAdd.mockImplementation(async (input: { precheck?: () => Promise<void> }) => {
    await input.precheck?.()
    return { state: {}, transaction: { type: 'free_agent_added' } }
  })
})

describe('add_free_agent answers exactly as the native add/drop', () => {
  it('Best Ball free agency switched off (bbFaEnabled false)', async () => {
    m.phase.mockResolvedValue({ immediateAddsAllowed: false, firstComeAdds: false, reason: 'Free agency is off in this Best Ball league.', code: 'best_ball_fa_disabled' })
    const n = await native()
    const r = await runtime()
    expect(n.status).toBe(403)
    expect(pick(r)).toEqual(pick(n))
    expect(r.body.code).toBe('LEAGUE_NOT_ACTIVE')
    expect(m.runtimeAdd).not.toHaveBeenCalled()
  })

  it('a chopped Guilly team', async () => {
    m.legality.mockResolvedValue({ ok: false, error: 'This team has been eliminated and cannot make transactions.', code: 'ELIMINATED_ROSTER' })
    const n = await native()
    const r = await runtime()
    expect(n.body.ok).toBe(false)
    expect(pick(r)).toEqual(pick(n))
    expect(m.runtimeAdd).not.toHaveBeenCalled()
  })

  it("a chopped team's released player still in the after-drop hold", async () => {
    m.hold.mockResolvedValue({ until: new Date('2026-10-21T11:00:00Z'), droppedByRosterId: 'rr-chopped' })
    const n = await native()
    const r = await runtime()
    expect(n.body.code).toBe('WAIVER_REQUIRED')
    expect(pick(r)).toEqual(pick(n))
    expect(m.runtimeAdd).not.toHaveBeenCalled()
  })

  it('the eligibility check runs inside the add (under the lock) and maps to the same code', async () => {
    m.eligibility.mockRejectedValue(new Error('This player is already on another roster in this league.'))
    m.executeAdd.mockImplementation(async () => {
      await m.eligibility()
    })
    const n = await native()
    const r = await runtime()
    expect(n.body.code).toBe('PLAYER_UNAVAILABLE')
    expect(pick(r)).toEqual(pick(n))
    expect(m.runtimeAdd).toHaveBeenCalledTimes(1)
  })

  it("a commissioner's override no longer skips the rules (owner's call, 2026-11-07)", async () => {
    // A commissioner adding to ANOTHER manager's roster — the only case the old override applied to.
    m.prisma.redraftRoster.findFirst.mockResolvedValue({ id: 'rr1', ownerId: 'someone-else', seasonId: 's1', leagueId: 'L' })
    const access = await import('@/lib/league/league-access')
    vi.mocked(access.assertLeagueCommissioner).mockResolvedValue({ ok: true } as never)
    m.phase.mockResolvedValue({ immediateAddsAllowed: false, firstComeAdds: false, reason: 'Free agency is off in this Best Ball league.', code: 'best_ball_fa_disabled' })
    const r = await runtime({ commissionerOverride: true })
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('LEAGUE_NOT_ACTIVE')
    expect(m.runtimeAdd).not.toHaveBeenCalled()
    vi.mocked(access.assertLeagueCommissioner).mockResolvedValue({ ok: false, status: 403 } as never)
  })

  it('an allowed add goes through, with the eligibility check handed to the locked add', async () => {
    const r = await runtime()
    expect(r.body.ok).toBe(true)
    expect(m.eligibility).toHaveBeenCalledWith(expect.objectContaining({ leagueId: 'L', rosterId: 'g1', addPlayerId: 'star' }))
  })
})
