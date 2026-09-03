import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  resolveProfileAccess, getProfileById, findManyEvidence,
  readManagerTrajectory, summariseTrajectory, loadPsychologyConsistencySlice,
  runUnifiedOrchestration, buildEnvelopeForTool,
} = vi.hoisted(() => ({
  resolveProfileAccess: vi.fn(),
  getProfileById: vi.fn(),
  findManyEvidence: vi.fn(),
  readManagerTrajectory: vi.fn(),
  summariseTrajectory: vi.fn(),
  loadPsychologyConsistencySlice: vi.fn(),
  runUnifiedOrchestration: vi.fn(),
  buildEnvelopeForTool: vi.fn((tool: string, args: unknown) => ({ tool, ...(args as object) })),
}))

vi.mock('@/lib/psychological-profiles/ProfileAccess', () => ({ resolveProfileAccess }))
vi.mock('@/lib/psychological-profiles/ManagerBehaviorQueryService', () => ({ getProfileById }))
vi.mock('@/lib/prisma', () => ({
  prisma: { profileEvidenceRecord: { findMany: findManyEvidence } },
}))
vi.mock('@/lib/psychological-profiles/ProfileSeasonSnapshot', () => ({ readManagerTrajectory, summariseTrajectory }))
vi.mock('@/lib/decision-os/grounding/psychologyConsistencySlice', () => ({ loadPsychologyConsistencySlice }))
vi.mock('@/lib/ai-orchestration', () => ({ runUnifiedOrchestration }))
vi.mock('@/lib/ai-tool-layer', () => ({
  buildEnvelopeForTool,
  formatToolResult: vi.fn(),
  validateToolOutput: vi.fn(() => ({ warnings: [], errors: [] })),
}))

import { POST } from '@/app/api/leagues/[leagueId]/psychological-profiles/explain/route'

const NO_TRAJECTORY = { hasTrajectory: false, summary: '', seasonsRecorded: 0 }
const REAL_TRAJECTORY = { hasTrajectory: true, summary: '2024: rebuilder → 2026: win-now.', seasonsRecorded: 2 }

function profileFixture(over: Record<string, unknown> = {}) {
  return {
    id: 'p1', leagueId: 'L1', managerId: 'm1', sport: 'NFL', sportLabel: 'NFL',
    profileLabels: ['aggressive'], aggressionScore: 80, activityScore: 50,
    tradeFrequencyScore: 60, waiverFocusScore: 40, riskToleranceScore: 55,
    evidenceCount: 30,
    ...over,
  }
}

function req() {
  return { json: async () => ({ profileId: 'p1' }) } as unknown as Request
}
function ctx() {
  return { params: Promise.resolve({ leagueId: 'L1' }) }
}

/**
 * ── R4b.6 — the existing "explain this profile" narration gains trajectory + self-only
 * cross-league/cross-sport, the same P2/P4 discipline the route already applies to labels and
 * scores: structured facts in, AI narrates, never claim what the payload does not contain.
 *
 * `runUnifiedOrchestration` is forced to fail in every test here so the route falls back to its
 * own deterministic `fallbackNarrative` — that keeps these tests about MY new payload-shaping and
 * fallback-text logic, not about the AI call, and it is 100% first-party code either way.
 */
describe('R4b.6 — psychological-profiles/explain route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findManyEvidence.mockResolvedValue([])
    runUnifiedOrchestration.mockResolvedValue({ ok: false })
  })

  it('trajectory is fetched for ANY profile the caller can see, not just their own', async () => {
    resolveProfileAccess.mockResolvedValue({ ok: true, userId: 'u1', ownManagerIds: new Set(['other-manager']), canSeeOpponents: true })
    getProfileById.mockResolvedValue(profileFixture())
    readManagerTrajectory.mockResolvedValue([])
    summariseTrajectory.mockReturnValue(REAL_TRAJECTORY)

    await POST(req(), ctx())
    expect(readManagerTrajectory).toHaveBeenCalledWith({ leagueId: 'L1', managerId: 'm1' })
  })

  it('🛑 cross-league/cross-sport is fetched for the caller\'s OWN profile, not skipped', async () => {
    resolveProfileAccess.mockResolvedValue({ ok: true, userId: 'u1', ownManagerIds: new Set(['m1']), canSeeOpponents: true })
    getProfileById.mockResolvedValue(profileFixture())
    readManagerTrajectory.mockResolvedValue([])
    summariseTrajectory.mockReturnValue(NO_TRAJECTORY)
    loadPsychologyConsistencySlice.mockResolvedValue({ present: false, gap: { reason: 'not_computed' } })

    await POST(req(), ctx())
    expect(loadPsychologyConsistencySlice).toHaveBeenCalledWith({ userId: 'u1', leagueId: 'L1' })
  })

  it('🛑 cross-league/cross-sport is SKIPPED for another manager\'s profile, even when the caller may view it', async () => {
    // canSeeOpponents:true means the CALLER may READ this profile at all — a separate question
    // from whether the explanation may include the SUBJECT's own cross-league/cross-sport data,
    // which loadPsychologyConsistencySlice restricts to the account it's called with by design.
    resolveProfileAccess.mockResolvedValue({ ok: true, userId: 'u1', ownManagerIds: new Set(['not-m1']), canSeeOpponents: true })
    getProfileById.mockResolvedValue(profileFixture())
    readManagerTrajectory.mockResolvedValue([])
    summariseTrajectory.mockReturnValue(NO_TRAJECTORY)

    await POST(req(), ctx())
    expect(loadPsychologyConsistencySlice).not.toHaveBeenCalled()
  })

  it('a real trajectory reaches BOTH the deterministic payload and the fallback narrative text', async () => {
    resolveProfileAccess.mockResolvedValue({ ok: true, userId: 'u1', ownManagerIds: new Set(['m1']), canSeeOpponents: false })
    getProfileById.mockResolvedValue(profileFixture())
    readManagerTrajectory.mockResolvedValue([{ season: 2026 }])
    summariseTrajectory.mockReturnValue(REAL_TRAJECTORY)
    loadPsychologyConsistencySlice.mockResolvedValue({ present: false, gap: { reason: 'not_computed' } })

    const res = await POST(req(), ctx())
    const body = await res.json()
    expect(body.narrative).toContain('2024: rebuilder → 2026: win-now')
    expect(body.trajectory).toEqual(REAL_TRAJECTORY)

    const envelopeArg = buildEnvelopeForTool.mock.calls[0][1] as { deterministicPayload: { trajectory: unknown } }
    expect(envelopeArg.deterministicPayload.trajectory).toEqual({ summary: REAL_TRAJECTORY.summary, seasonsRecorded: 2 })
  })

  it('NO trajectory means a null field, not a fabricated "no history" sentence in the payload', async () => {
    resolveProfileAccess.mockResolvedValue({ ok: true, userId: 'u1', ownManagerIds: new Set(['m1']), canSeeOpponents: false })
    getProfileById.mockResolvedValue(profileFixture())
    readManagerTrajectory.mockResolvedValue([])
    summariseTrajectory.mockReturnValue(NO_TRAJECTORY)
    loadPsychologyConsistencySlice.mockResolvedValue({ present: false, gap: { reason: 'not_computed' } })

    const res = await POST(req(), ctx())
    const body = await res.json()
    expect(body.trajectory).toBeNull()
    expect(body.narrative).not.toContain('Trajectory:')
    const envelopeArg = buildEnvelopeForTool.mock.calls[0][1] as { deterministicPayload: { trajectory: unknown } }
    expect(envelopeArg.deterministicPayload.trajectory).toBeNull()
  })

  it('🛑 a single shared league is NOT reported as a consistency pattern, even if the rollup returns one label', async () => {
    // Defence in depth: the rollup itself already refuses at <=1 observed, but this payload-shaping
    // code re-checks rather than trusting a caller's shape blindly.
    resolveProfileAccess.mockResolvedValue({ ok: true, userId: 'u1', ownManagerIds: new Set(['m1']), canSeeOpponents: false })
    getProfileById.mockResolvedValue(profileFixture())
    readManagerTrajectory.mockResolvedValue([])
    summariseTrajectory.mockReturnValue(NO_TRAJECTORY)
    loadPsychologyConsistencySlice.mockResolvedValue({
      present: true,
      value: { crossLeagueObserved: 1, crossLeagueWithoutProfile: 0, crossLeagueConsistentLabels: ['aggressive'], crossLeagueCaveat: null, crossSportObserved: 0, crossSportWithoutProfile: 0, crossSportConsistentLabels: [], crossSportSpecificLabels: [], crossSportCaveat: null },
    })

    const res = await POST(req(), ctx())
    const body = await res.json()
    expect(body.crossLeagueConsistency).toBeNull()
  })

  it('real cross-league and cross-sport consistency reach the JSON response fields', async () => {
    resolveProfileAccess.mockResolvedValue({ ok: true, userId: 'u1', ownManagerIds: new Set(['m1']), canSeeOpponents: false })
    getProfileById.mockResolvedValue(profileFixture())
    readManagerTrajectory.mockResolvedValue([])
    summariseTrajectory.mockReturnValue(NO_TRAJECTORY)
    loadPsychologyConsistencySlice.mockResolvedValue({
      present: true,
      value: {
        crossLeagueObserved: 3, crossLeagueWithoutProfile: 0, crossLeagueConsistentLabels: ['aggressive'], crossLeagueCaveat: null,
        crossSportObserved: 2, crossSportWithoutProfile: 0, crossSportConsistentLabels: ['trade-heavy'], crossSportSpecificLabels: ['patient'], crossSportCaveat: null,
      },
    })

    const res = await POST(req(), ctx())
    const body = await res.json()
    expect(body.crossLeagueConsistency).toEqual({ leaguesObserved: 3, consistentLabels: ['aggressive'] })
    expect(body.crossSportConsistency).toEqual({ sportsObserved: 2, consistentLabels: ['trade-heavy'], sportSpecificLabels: ['patient'] })
  })
})
