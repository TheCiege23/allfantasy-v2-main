/** The open draft room's tick picks for an autopilot team at once, and sends it no time warning. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const now = new Date('2026-01-15T12:00:00.000Z')
const hm = vi.hoisted(() => ({
  instant: vi.fn(),
  bpa: vi.fn(),
  submitPick: vi.fn(),
  approaching: vi.fn(),
  autoPickFired: vi.fn(),
  session: {} as Record<string, unknown>,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/live-draft-engine/instantAutopick', async (orig) => ({
  ...(await orig<typeof import('@/lib/live-draft-engine/instantAutopick')>()),
  instantAutopickReason: hm.instant,
}))
vi.mock('@/lib/tournament/seasonDraftMutationGate', () => ({ isSeasonTournamentDraft: vi.fn(async () => false), SEASON_DRAFT_MUTATION_BLOCKED: 'x' }))
vi.mock('@/lib/tournament/seasonDraftRuntime', () => ({ loadSeasonDraftContext: vi.fn(async () => null) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: vi.fn(async () => ({ settings: {} })), update: vi.fn(async () => ({})) },
    draftSession: { findFirst: vi.fn(async () => hm.session) },
    roster: { findUnique: vi.fn(async () => ({ platformUserId: 'u1' })) },
  },
}))
vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', async (orig) => ({
  ...(await orig<typeof import('@/lib/draft-defaults/DraftUISettingsResolver')>()),
  getDraftUISettingsForLeague: vi.fn(async () => ({ autoPickEnabled: true, timerMode: 'per_pick', slowDraftPauseWindow: null })),
}))
vi.mock('@/lib/draft-defaults/DraftRoomConfigResolver', () => ({ getDraftConfigForLeague: vi.fn(async () => ({ autopick_behavior: 'skip' })) }))
vi.mock('@/lib/live-draft-engine/autopickBestAvailableSubmit', () => ({ submitBestAvailableAutopickForExpiredTimer: hm.bpa }))
vi.mock('@/lib/live-draft-engine/PickSubmissionService', () => ({ submitPick: hm.submitPick }))
vi.mock('@/lib/live-draft-engine/RosterFitValidation', () => ({ getAllowedPositionsAndRosterSize: vi.fn(async () => null) }))
vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({ pauseDraftSession: vi.fn(), resumeDraftSession: vi.fn() }))
vi.mock('@/lib/draft-notifications', () => ({
  notifyAutoPickFired: hm.autoPickFired, notifyApproachingTimeout: hm.approaching, notifyDraftIntelPickConfirmation: vi.fn(async () => null),
  notifyDraftIntelOnClockUrgent: vi.fn(async () => null), notifyDraftIntelQueueReady: vi.fn(async () => null), notifyOnTheClockAfterPick: vi.fn(),
  notifyQueuePlayerUnavailable: vi.fn(), notifySlowDraftReminder: vi.fn(), notifyDraftPaused: vi.fn(), notifyDraftResumed: vi.fn(),
}))
vi.mock('@/lib/draft-intelligence', () => ({ publishDraftIntelForUpcomingManagers: vi.fn(async () => []), sendDraftIntelDm: vi.fn(async () => null) }))

import { runSlowDraftAutomationTick } from '@/lib/live-draft-engine/slow-draft/SlowDraftRuntimeService'

beforeEach(() => {
  vi.clearAllMocks()
  hm.session = {
    id: 'ds-1', leagueId: 'L', status: 'in_progress', draftType: 'snake', cpuAutoPick: true,
    timerEndAt: new Date('2026-01-15T12:00:10.000Z'), // 10s left: inside the time-warning window
    timerSeconds: 90, pausedRemainingSeconds: null, rounds: 15, teamCount: 2, thirdRoundReversal: false,
    slotOrder: [{ slot: 1, rosterId: 'r1', displayName: 'T1' }, { slot: 2, rosterId: 'r2', displayName: 'T2' }],
    tradedPicks: [], picks: [], queues: [],
  }
  hm.bpa.mockResolvedValue({ ok: true, pick: { playerName: 'Rookie A' } })
})

describe('the open room tick', () => {
  it('picks for an autopilot team at once — never skipping it — and sends it no time warning', async () => {
    hm.instant.mockResolvedValue('autopilot')
    const r = await runSlowDraftAutomationTick('L', now)
    expect(hm.bpa).toHaveBeenCalledWith('L', 'r1', 1)
    expect(hm.submitPick).not.toHaveBeenCalled()
    expect(r.actions).toContainEqual(expect.objectContaining({ type: 'auto_pick', rosterId: 'r1' }))
    expect(hm.approaching).not.toHaveBeenCalled()
  })

  it('leaves an ordinary team to its clock, and warns it', async () => {
    hm.instant.mockResolvedValue(null)
    await runSlowDraftAutomationTick('L', now)
    expect(hm.bpa).not.toHaveBeenCalled()
    expect(hm.approaching).toHaveBeenCalled()
  })
})
