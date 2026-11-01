import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  session: vi.fn(),
  canAccess: vi.fn(),
  snapshot: vi.fn(),
  uiSettings: vi.fn(),
  orphans: vi.fn(),
  aiRow: vi.fn(),
  execute: vi.fn(),
  viewerRoster: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: { draftSession: { findFirst: h.aiRow } } }))
vi.mock('@/lib/live-draft-engine/auth', () => ({
  canAccessLeagueDraft: h.canAccess,
  getCurrentUserRosterIdForLeague: h.viewerRoster,
}))
vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({ buildSessionSnapshot: h.snapshot }))
vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', () => ({ getDraftUISettingsForLeague: h.uiSettings }))
vi.mock('@/lib/orphan-ai-manager/orphanRosterResolver', () => ({ getOrphanRosterIdsForLeague: h.orphans }))
vi.mock('@/lib/orphan-ai-manager/OrphanAIManagerService', () => ({ executeDraftPickForOrphan: h.execute }))
vi.mock('@/lib/provider-config', () => ({ getProviderStatus: () => ({ anyAi: true }) }))

import { POST } from '@/app/api/leagues/[leagueId]/draft/chimmy-manager-pick/route'

const params = { params: Promise.resolve({ leagueId: 'lg1' }) }
const req = (body: unknown) =>
  new Request('http://x/api/leagues/lg1/draft/chimmy-manager-pick', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as never

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    status: 'in_progress',
    currentPick: { overall: 7, rosterId: 'r-chimmy', round: 1, slot: 7 },
    // A 90s clock that started 10s ago — the thinking time has passed.
    timerSeconds: 90,
    timerEndAt: new Date(Date.now() + 80_000).toISOString(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.session.mockResolvedValue({ user: { id: 'member-1' } })
  h.canAccess.mockResolvedValue(true)
  h.snapshot.mockResolvedValue(snapshot())
  h.uiSettings.mockResolvedValue({ orphanTeamAiManagerEnabled: true, orphanDrafterMode: 'cpu' })
  h.orphans.mockResolvedValue(['r-chimmy', 'r-orphan-unassigned'])
  h.aiRow.mockResolvedValue({
    commissionerAiManagers: {
      assignments: [{ rosterId: 'r-chimmy', aiStyle: 'BPA', tradeAggression: 'none', active: true }],
      tradeRules: {
        allowOutbound: true,
        allowInbound: true,
        blockAiToAi: true,
        proposalCooldownSeconds: 90,
        maxProposalsPerRound: 4,
        acceptConfidenceMin: 0.58,
      },
    },
  })
  h.execute.mockResolvedValue({ success: true, pick: { playerName: 'A Player', position: 'RB', overall: 7, round: 1, slot: 7 } })
  h.viewerRoster.mockResolvedValue('r-human')
})

describe('POST /draft/chimmy-manager-pick', () => {
  it('lets any league member trigger the pick and passes the pick number through', async () => {
    const res = await POST(req({ expectedOverall: 7 }), params)
    expect(res.status).toBe(200)
    expect(h.execute).toHaveBeenCalledWith({ leagueId: 'lg1', triggeredByUserId: 'member-1', expectedOverall: 7 })
    expect((await res.json()).ok).toBe(true)
  })

  it('refuses a signed-out caller and a non-member', async () => {
    h.session.mockResolvedValueOnce(null)
    expect((await POST(req({ expectedOverall: 7 }), params)).status).toBe(401)
    h.canAccess.mockResolvedValueOnce(false)
    expect((await POST(req({ expectedOverall: 7 }), params)).status).toBe(403)
    expect(h.execute).not.toHaveBeenCalled()
  })

  it('needs the pick number', async () => {
    expect((await POST(req({}), params)).status).toBe(400)
    expect(h.execute).not.toHaveBeenCalled()
  })

  it('refuses a pick that another room already made', async () => {
    const res = await POST(req({ expectedOverall: 6 }), params)
    expect(res.status).toBe(409)
    expect((await res.json()).skipped).toBe(true)
    expect(h.execute).not.toHaveBeenCalled()
  })

  it('does not pick for an orphan nobody assigned to Chimmy', async () => {
    h.snapshot.mockResolvedValue(snapshot({ currentPick: { overall: 7, rosterId: 'r-orphan-unassigned', round: 1, slot: 7 } }))
    const res = await POST(req({ expectedOverall: 7 }), params)
    expect(res.status).toBe(409)
    expect((await res.json()).reason).toBe('not_assigned')
    expect(h.execute).not.toHaveBeenCalled()
  })

  it('does not pick for a team a person has claimed', async () => {
    h.orphans.mockResolvedValue([])
    const res = await POST(req({ expectedOverall: 7 }), params)
    expect((await res.json()).reason).toBe('not_orphan')
    expect(h.execute).not.toHaveBeenCalled()
  })

  it('does not pick in a paused draft', async () => {
    h.snapshot.mockResolvedValue(snapshot({ status: 'paused' }))
    expect((await POST(req({ expectedOverall: 7 }), params)).status).toBe(409)
    expect(h.execute).not.toHaveBeenCalled()
  })

  it('asks the room to retry while Chimmy is still thinking', async () => {
    h.snapshot.mockResolvedValue(snapshot({ timerEndAt: new Date(Date.now() + 89_000).toISOString() }))
    const res = await POST(req({ expectedOverall: 7 }), params)
    expect(res.status).toBe(409)
    expect((await res.json()).retry).toBe(true)
    expect(h.execute).not.toHaveBeenCalled()
  })

  it('reports a pick that lost the race as stale, not as an error', async () => {
    h.execute.mockResolvedValue({ success: false, error: 'Draft board moved', code: 'DRAFT_PICK_STALE_OVERALL' })
    const res = await POST(req({ expectedOverall: 7 }), params)
    expect(res.status).toBe(409)
    expect((await res.json()).skipped).toBe(true)
  })
})
