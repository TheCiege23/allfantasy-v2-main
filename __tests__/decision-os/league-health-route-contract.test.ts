/**
 * Commissioner OS Surface Alignment — Phase B Increment 3.
 *
 * Contract test for `/api/league-health`: the legacy explicit-metrics body is preserved
 * byte-for-byte (existing behavior), and a new, EXPLICIT `{ leagueId, source: 'decision_os' }`
 * opt-in additively routes to the Decision OS-federated composition. No DB, no network —
 * `resolveDecisionOsLeagueHealth` and `monitorLeagueHealth` are exercised through their own
 * dedicated suites; this file only proves the route's dispatch contract.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getServerSessionMock, resolveDecisionOsLeagueHealthMock, authorizeLeagueReadMock } = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  resolveDecisionOsLeagueHealthMock: vi.fn(),
  authorizeLeagueReadMock: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/decision-os/leagueHealthAlignment', () => ({
  resolveDecisionOsLeagueHealth: resolveDecisionOsLeagueHealthMock,
}))
vi.mock('@/lib/decision-os/leagueReadAuthorization', () => ({
  authorizeLeagueRead: authorizeLeagueReadMock,
}))

import { POST } from '@/app/api/league-health/route'

function req(body: unknown) {
  return new Request('http://localhost/api/league-health', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0]
}

describe('/api/league-health route contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'u1' } })
    authorizeLeagueReadMock.mockResolvedValue({ authorized: true, role: 'commissioner' })
  })

  it('requires auth (401) regardless of path', async () => {
    getServerSessionMock.mockResolvedValue(null)
    const res = await POST(req({ leagueId: 'L1', source: 'decision_os' }))
    expect(res.status).toBe(401)
  })

  it('legacy explicit-metrics body is preserved: full input -> the untouched engine result, unchanged', async () => {
    const res = await POST(
      req({
        leagueId: 'L1', sport: 'NFL', leagueType: 'dynasty', numTeams: 12, currentWeek: 5, totalWeeks: 17,
        activeManagers: 12, inactiveManagers: 0, abandonedTeams: 0, lineupSubmissionRate: 1,
        totalTradesThisSeason: 5, totalWaiverClaims: 20, avgFaabSpentPct: 40, chatMessageCount: 30,
        voteCount: 0, disputeCount: 0, commissionerActionsThisSeason: 2, unresolvedDisputes: 0,
        playoffTeams: 6, waiverType: 'FAAB', tradeReviewProcess: 'commissioner',
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.overallStatus).toBe('excellent')
    expect(resolveDecisionOsLeagueHealthMock).not.toHaveBeenCalled() // legacy path never touches the new composition
  })

  it('rejects an invalid legacy body exactly as before (400)', async () => {
    const res = await POST(req({ leagueId: 'L1', numTeams: 'not-a-number' }))
    expect(res.status).toBe(400)
  })

  it('an explicit { leagueId, source: "decision_os" } body routes to the new composition, additively', async () => {
    const fakeResult = {
      engine: { overallStatus: 'healthy', leagueHealthScore: 70 },
      decisionOs: { activityEventCount: 12, activeManagerCount: 4, trend: { available: false, reason: 'no_snapshots' } },
      fieldProvenance: {},
    }
    resolveDecisionOsLeagueHealthMock.mockResolvedValue(fakeResult)

    const res = await POST(req({ leagueId: 'L1', source: 'decision_os' }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toEqual(fakeResult)
    expect(resolveDecisionOsLeagueHealthMock).toHaveBeenCalledWith('L1', {})
  })

  it('passes overrides through to the Decision OS composition when supplied', async () => {
    resolveDecisionOsLeagueHealthMock.mockResolvedValue({ engine: {}, decisionOs: {}, fieldProvenance: {} })

    await POST(req({ leagueId: 'L1', source: 'decision_os', overrides: { numTeams: 10 } }))

    expect(resolveDecisionOsLeagueHealthMock).toHaveBeenCalledWith('L1', { numTeams: 10 })
  })

  // Phase OS-C6.1: real per-league membership authorization coverage for the decision_os branch —
  // this route previously had no per-league check, same gap as `/api/decision-os/mission-control`.
  it('checks league read authorization for the decision_os branch, using the real leagueId and session user id', async () => {
    resolveDecisionOsLeagueHealthMock.mockResolvedValue({ engine: {}, decisionOs: {}, fieldProvenance: {} })
    await POST(req({ leagueId: 'L1', source: 'decision_os' }))
    expect(authorizeLeagueReadMock).toHaveBeenCalledWith('L1', 'u1')
  })

  it('denies an authenticated user with no relationship to the league (403) on the decision_os branch — no cross-league data leakage', async () => {
    authorizeLeagueReadMock.mockResolvedValue({ authorized: false, status: 403 })
    const res = await POST(req({ leagueId: 'L1', source: 'decision_os' }))
    expect(res.status).toBe(403)
    expect(resolveDecisionOsLeagueHealthMock).not.toHaveBeenCalled()
  })

  it('the legacy explicit-metrics branch is unaffected by the new gate — it never checks league membership since it has no league-scoped read', async () => {
    authorizeLeagueReadMock.mockResolvedValue({ authorized: false, status: 403 })
    const res = await POST(
      req({
        leagueId: 'L1', sport: 'NFL', leagueType: 'dynasty', numTeams: 12, currentWeek: 5, totalWeeks: 17,
        activeManagers: 12, inactiveManagers: 0, abandonedTeams: 0, lineupSubmissionRate: 1,
        totalTradesThisSeason: 5, totalWaiverClaims: 20, avgFaabSpentPct: 40, chatMessageCount: 30,
        voteCount: 0, disputeCount: 0, commissionerActionsThisSeason: 2, unresolvedDisputes: 0,
        playoffTeams: 6, waiverType: 'FAAB', tradeReviewProcess: 'commissioner',
      }),
    )
    expect(res.status).toBe(200)
    expect(authorizeLeagueReadMock).not.toHaveBeenCalled()
  })
})
