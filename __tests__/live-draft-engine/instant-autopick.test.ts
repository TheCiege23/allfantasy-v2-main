/**
 * Phase 7 (2026-10-29): an autopilot team, or a manager on "Auto-pick me", is picked for as soon as it
 * is on the clock — not when the clock runs out. What is picked does not change, only when.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const now = new Date('2026-01-15T12:00:00.000Z')
const hm = vi.hoisted(() => ({
  sessionFindMany: vi.fn(),
  sessionFindFirst: vi.fn(),
  leagueFindUnique: vi.fn(),
  rosterFindUnique: vi.fn(),
  prefFindUnique: vi.fn(),
  tryQueueAutoPick: vi.fn(),
  bpa: vi.fn(),
  submitPick: vi.fn(),
  getDraftConfigForLeague: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftSession: { findMany: hm.sessionFindMany, findFirst: hm.sessionFindFirst, findUnique: hm.sessionFindFirst },
    draftPick: { findFirst: vi.fn(async () => null) },
    league: { findUnique: hm.leagueFindUnique },
    roster: { findUnique: hm.rosterFindUnique },
    liveDraftAutopickPreference: { findUnique: hm.prefFindUnique },
  },
}))
vi.mock('@/lib/league/league-roster-draft-gate', () => ({ isLeagueRosterDraftReady: vi.fn(async () => true) }))
vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', async (orig) => ({
  ...(await orig<typeof import('@/lib/draft-defaults/DraftUISettingsResolver')>()),
  getDraftUISettingsForLeague: vi.fn(async () => ({ autoPickEnabled: true, timerMode: 'per_pick', slowDraftPauseWindow: null })),
}))
vi.mock('@/lib/draft-defaults/DraftRoomConfigResolver', () => ({ getDraftConfigForLeague: hm.getDraftConfigForLeague }))
vi.mock('@/lib/live-draft-engine/slow-draft/SlowDraftRuntimeService', () => ({ tryQueueAutoPick: hm.tryQueueAutoPick }))
vi.mock('@/lib/live-draft-engine/autopickBestAvailableSubmit', () => ({ submitBestAvailableAutopickForExpiredTimer: hm.bpa }))
vi.mock('@/lib/live-draft-engine/PickSubmissionService', () => ({ submitPick: hm.submitPick }))
vi.mock('@/lib/live-draft-engine/RosterAssignmentService', () => ({ appendPickToRosterDraftSnapshot: vi.fn(async () => undefined) }))
vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({ buildSessionSnapshot: vi.fn(), reconcileOvernightDraftTimerForLeague: vi.fn(async () => undefined) }))
vi.mock('@/lib/league/invalidateLeagueDraftCaches', () => ({ invalidateLeagueDraftCaches: vi.fn() }))
vi.mock('@/lib/draft-notifications', () => ({
  notifyAutoPickFired: vi.fn(), notifyDraftIntelPickConfirmation: vi.fn(), notifyDraftIntelOnClockUrgent: vi.fn(),
  notifyDraftIntelQueueReady: vi.fn(), notifyOnTheClockAfterPick: vi.fn(), notifyQueuePlayerUnavailable: vi.fn(),
}))
vi.mock('@/lib/draft-intelligence', () => ({ publishDraftIntelForUpcomingManagers: vi.fn(async () => []), sendDraftIntelDm: vi.fn(async () => null) }))
vi.mock('@/lib/live-draft-engine/auction', () => ({ runAuctionAutomationTick: vi.fn() }))

import { processExpiredDraftPickForLeague, processExpiredDraftPicks } from '@/lib/live-draft-engine/expired-picks/processExpiredDraftPicks'
import { shouldPickNow } from '@/lib/live-draft-engine/instantAutopick'

const AUTOPILOT = { af_managed_lineups: { r1: { since: 'x', byUserId: 'c', autopilot: { style: 'dynasty_owner', since: 'x', byUserId: 'c' } } } }
const session = (over: Record<string, unknown> = {}) => ({
  id: 'ds-1', leagueId: 'L', version: 3, status: 'in_progress', draftType: 'snake', cpuAutoPick: true,
  timerEndAt: new Date('2026-01-15T12:01:00.000Z'), // 60s left on the clock
  timerSeconds: 90, pausedRemainingSeconds: null, rounds: 15, teamCount: 2, thirdRoundReversal: false,
  slotOrder: [{ slot: 1, rosterId: 'r1', displayName: 'T1' }, { slot: 2, rosterId: 'r2', displayName: 'T2' }],
  tradedPicks: [], picks: [], queues: [], ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  hm.sessionFindFirst.mockResolvedValue(session())
  hm.leagueFindUnique.mockResolvedValue({ settings: {} })
  hm.rosterFindUnique.mockResolvedValue({ platformUserId: 'user-1' })
  hm.prefFindUnique.mockResolvedValue(null)
  hm.tryQueueAutoPick.mockResolvedValue({ success: false })
  hm.bpa.mockResolvedValue({ ok: true, pick: { playerName: 'Rookie A', position: 'WR', team: 'X', playerId: 'p', byeWeek: null } })
  hm.getDraftConfigForLeague.mockResolvedValue({ autopick_behavior: 'queue-first' })
})

describe('shouldPickNow', () => {
  it('an expired clock always; a running or untimed clock only for a team that picks without waiting; never while paused', () => {
    expect(shouldPickNow('expired', null)).toBe(true)
    expect(shouldPickNow('running', null)).toBe(false)
    expect(shouldPickNow('running', 'autopilot')).toBe(true)
    expect(shouldPickNow('none', 'autopick_me')).toBe(true)
    expect(shouldPickNow('paused', 'autopilot')).toBe(false)
  })
})

describe('the draft tick', () => {
  it('waits out the clock for an ordinary team', async () => {
    expect(await processExpiredDraftPickForLeague('L', now)).toMatchObject({ outcome: 'skipped', reason: 'timer_not_expired' })
    expect(hm.bpa).not.toHaveBeenCalled()
  })

  it('picks for an autopilot team at once, with 60 seconds still on the clock', async () => {
    hm.leagueFindUnique.mockResolvedValue({ settings: AUTOPILOT })
    expect(await processExpiredDraftPickForLeague('L', now)).toMatchObject({ outcome: 'processed_bpa' })
    expect(hm.bpa).toHaveBeenCalledWith('L', 'r1', 1)
  })

  it('picks for a manager on "Auto-pick me" at once, and in an untimed draft too', async () => {
    hm.prefFindUnique.mockResolvedValue({ enabled: true })
    expect(await processExpiredDraftPickForLeague('L', now)).toMatchObject({ outcome: 'processed_bpa' })
    expect(hm.prefFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { draft_session_user_unique: { draftSessionId: 'ds-1', userId: 'user-1' } } }))
    hm.sessionFindFirst.mockResolvedValue(session({ timerEndAt: null }))
    expect(await processExpiredDraftPickForLeague('L', now)).toMatchObject({ outcome: 'processed_bpa' })
  })

  it('never skips a team that asked for a pick, even in a league that skips on timeout', async () => {
    hm.getDraftConfigForLeague.mockResolvedValue({ autopick_behavior: 'skip' })
    hm.leagueFindUnique.mockResolvedValue({ settings: AUTOPILOT })
    expect(await processExpiredDraftPickForLeague('L', now)).toMatchObject({ outcome: 'processed_bpa' })
    expect(hm.submitPick).not.toHaveBeenCalled()
  })

  it('does nothing while the commissioner has the draft paused', async () => {
    hm.leagueFindUnique.mockResolvedValue({ settings: AUTOPILOT })
    hm.sessionFindFirst.mockResolvedValue(session({ status: 'paused', timerEndAt: null, pausedRemainingSeconds: 40 }))
    expect(await processExpiredDraftPickForLeague('L', now)).toMatchObject({ outcome: 'skipped' })
    expect(hm.bpa).not.toHaveBeenCalled()
  })

  it('the minute tick also looks at drafts whose clock has not run out', async () => {
    hm.sessionFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ leagueId: 'L', draftType: 'snake' }])
    hm.leagueFindUnique.mockResolvedValue({ settings: AUTOPILOT })
    const summary = await processExpiredDraftPicks({ now })
    expect(summary).toMatchObject({ scanned: 1, processed: 1 })
    expect(hm.sessionFindMany.mock.calls[1][0].where).toMatchObject({ status: 'in_progress', OR: [{ timerEndAt: null }, { timerEndAt: { gt: now } }] })
  })
})
