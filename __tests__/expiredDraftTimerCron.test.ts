import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  draftFindMany,
  leagueFindMany,
  draftFindUnique,
  leagueFindUnique,
  reconcile,
  runSlow,
  runAuction,
  runKeeper,
  logStructured,
  recordEngineTelemetrySample,
  withPickLockMock,
  withAuctionLockMock,
} = vi.hoisted(() => ({
  draftFindMany: vi.fn(),
  leagueFindMany: vi.fn(),
  draftFindUnique: vi.fn(),
  leagueFindUnique: vi.fn(),
  reconcile: vi.fn(),
  runSlow: vi.fn(),
  runAuction: vi.fn(),
  runKeeper: vi.fn(),
  logStructured: vi.fn(),
  recordEngineTelemetrySample: vi.fn(),
  withPickLockMock: vi.fn(async (_leagueId: string, fn: () => Promise<unknown>) => ({
    acquired: true,
    value: await fn(),
    backend: 'postgres' as const,
  })),
  withAuctionLockMock: vi.fn(async (_leagueId: string, fn: () => Promise<unknown>) => ({
    acquired: true,
    value: await fn(),
    backend: 'postgres' as const,
  })),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftSession: {
      findMany: (...a: unknown[]) => draftFindMany(...a),
      findUnique: (...a: unknown[]) => draftFindUnique(...a),
    },
    league: {
      findMany: (...a: unknown[]) => leagueFindMany(...a),
      findUnique: (...a: unknown[]) => leagueFindUnique(...a),
    },
  },
}))

vi.mock('@/lib/draft/draftLock', () => ({
  withPickLock: (...a: unknown[]) => withPickLockMock(...a),
  withAuctionLock: (...a: unknown[]) => withAuctionLockMock(...a),
}))

vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({
  reconcileOvernightDraftTimerForLeague: (...a: unknown[]) => reconcile(...a),
}))

vi.mock('@/lib/live-draft-engine/slow-draft/SlowDraftRuntimeService', () => ({
  runSlowDraftAutomationTick: (...a: unknown[]) => runSlow(...a),
}))

vi.mock('@/lib/live-draft-engine/auction', () => ({
  runAuctionAutomationTick: (...a: unknown[]) => runAuction(...a),
}))

vi.mock('@/lib/live-draft-engine/keeper/KeeperAutomationService', () => ({
  runKeeperAutomationTick: (...a: unknown[]) => runKeeper(...a),
}))

vi.mock('@/lib/logging/structured', () => ({
  logStructured: (...a: unknown[]) => logStructured(...a),
}))

vi.mock('@/lib/analytics/recordAnalyticsEvent', () => ({
  recordEngineTelemetrySample: (...a: unknown[]) => recordEngineTelemetrySample(...a),
}))

import {
  draftSessionEligibleForExpiredWallClockCron,
  draftUISettingsFromLeagueStoredSettings,
} from '@/lib/draft-defaults/DraftUISettingsResolver'
import {
  discoverExpiredDraftTimerLeagues,
  processExpiredDraftTimerForLeague,
} from '@/lib/live-draft-engine/cron/expiredDraftTimerCron'

describe('draftSessionEligibleForExpiredWallClockCron', () => {
  it('includes auction drafts regardless of autoPick', () => {
    expect(
      draftSessionEligibleForExpiredWallClockCron({
        draftType: 'auction',
        ui: { autoPickEnabled: false, timerMode: 'per_pick' },
      }),
    ).toBe(true)
  })

  it('excludes snake when autoPick is disabled', () => {
    expect(
      draftSessionEligibleForExpiredWallClockCron({
        draftType: 'snake',
        ui: { autoPickEnabled: false, timerMode: 'per_pick' },
      }),
    ).toBe(false)
  })

  it('excludes snake when soft timer is on', () => {
    expect(
      draftSessionEligibleForExpiredWallClockCron({
        draftType: 'snake',
        ui: { autoPickEnabled: true, timerMode: 'soft_pause' },
      }),
    ).toBe(false)
  })

  it('includes snake when autoPick on and per_pick timer', () => {
    expect(
      draftSessionEligibleForExpiredWallClockCron({
        draftType: 'snake',
        ui: { autoPickEnabled: true, timerMode: 'per_pick' },
      }),
    ).toBe(true)
  })
})

describe('draftUISettingsFromLeagueStoredSettings', () => {
  it('reads commissioner auto-pick flag from stored settings', () => {
    const ui = draftUISettingsFromLeagueStoredSettings({
      draft_auto_pick_enabled: true,
      draft_timer_mode: 'per_pick',
    })
    expect(ui.autoPickEnabled).toBe(true)
    expect(ui.timerMode).toBe('per_pick')
  })
})

describe('discoverExpiredDraftTimerLeagues', () => {
  beforeEach(() => {
    draftFindMany.mockReset()
    leagueFindMany.mockReset()
  })

  it('returns only leagues eligible for cron (autoPick snake / auction)', async () => {
    const past = new Date('2026-01-15T12:00:00.000Z')
    draftFindMany.mockResolvedValueOnce([
      { leagueId: 'L-no-autopick', draftType: 'snake' },
      { leagueId: 'L-soft', draftType: 'snake' },
      { leagueId: 'L-ok', draftType: 'snake' },
      { leagueId: 'L-auc', draftType: 'auction' },
    ])
    leagueFindMany.mockResolvedValueOnce([
      {
        id: 'L-no-autopick',
        settings: { draft_auto_pick_enabled: false, draft_timer_mode: 'per_pick' },
      },
      {
        id: 'L-soft',
        settings: { draft_auto_pick_enabled: true, draft_timer_mode: 'soft_pause' },
      },
      {
        id: 'L-ok',
        settings: { draft_auto_pick_enabled: true, draft_timer_mode: 'per_pick' },
      },
      { id: 'L-auc', settings: { draft_auto_pick_enabled: false, draft_timer_mode: 'per_pick' } },
    ])

    const ids = await discoverExpiredDraftTimerLeagues(past, { limit: 10 })
    expect(ids).toEqual(['L-ok', 'L-auc'])
  })
})

describe('processExpiredDraftTimerForLeague', () => {
  beforeEach(() => {
    draftFindUnique.mockReset()
    leagueFindUnique.mockReset()
    reconcile.mockReset()
    runSlow.mockReset()
    runAuction.mockReset()
    runKeeper.mockReset()
    logStructured.mockReset()
    withPickLockMock.mockImplementation(async (_leagueId: string, fn: () => Promise<unknown>) => ({
      acquired: true,
      value: await fn(),
      backend: 'postgres',
    }))
    withAuctionLockMock.mockImplementation(async (_leagueId: string, fn: () => Promise<unknown>) => ({
      acquired: true,
      value: await fn(),
      backend: 'postgres',
    }))
  })

  it('skips cron policy when commissioner disabled auto-pick (snake)', async () => {
    draftFindUnique.mockResolvedValueOnce({ id: 'ds1', draftType: 'snake', status: 'in_progress' })
    leagueFindUnique.mockResolvedValue({
      settings: { draft_auto_pick_enabled: false, draft_timer_mode: 'per_pick' },
    })

    const out = await processExpiredDraftTimerForLeague('L1', new Date('2026-01-15T12:00:00.000Z'))
    expect(out).toEqual({ outcome: 'skipped_cron_policy', reason: 'autopick_disabled_or_soft_timer' })
    expect(reconcile).not.toHaveBeenCalled()
  })

  it('runs slow tick when timer still expired after reconcile (snake)', async () => {
    draftFindUnique
      .mockResolvedValueOnce({ id: 'ds2', draftType: 'snake', status: 'in_progress' })
      .mockResolvedValueOnce({
        draftType: 'snake',
        status: 'in_progress',
        timerEndAt: new Date('2020-01-01'),
      })
    leagueFindUnique.mockResolvedValue({
      settings: { draft_auto_pick_enabled: true, draft_timer_mode: 'per_pick' },
    })
    runSlow.mockResolvedValue({ changed: true, actions: [{ type: 'auto_pick', rosterId: 'r1', playerName: 'A' }] })

    const out = await processExpiredDraftTimerForLeague('L2', new Date('2026-01-15T12:00:00.000Z'))
    expect(out.outcome).toBe('processed')
    if (out.outcome === 'processed') {
      expect(out.changed).toBe(true)
      expect(out.domain).toBe('snake')
    }
    expect(runSlow).toHaveBeenCalledTimes(1)
    expect(runAuction).not.toHaveBeenCalled()
  })

  it('skips when reconcile clears timer before locked body (already advanced)', async () => {
    draftFindUnique
      .mockResolvedValueOnce({ id: 'ds3', draftType: 'snake', status: 'in_progress' })
      .mockResolvedValueOnce({
        draftType: 'snake',
        status: 'in_progress',
        timerEndAt: new Date('2030-01-01'),
      })
    leagueFindUnique.mockResolvedValue({
      settings: { draft_auto_pick_enabled: true, draft_timer_mode: 'per_pick' },
    })

    const out = await processExpiredDraftTimerForLeague('L3', new Date('2026-01-15T12:00:00.000Z'))
    expect(out).toMatchObject({ outcome: 'skipped_timer_not_expired', reason: 'timer_not_expired' })
    expect(runSlow).not.toHaveBeenCalled()
  })

  it('returns skipped_lock_busy when pick lock is held', async () => {
    withPickLockMock.mockResolvedValueOnce({ acquired: false, reason: 'busy' })
    draftFindUnique.mockResolvedValueOnce({ id: 'ds4', draftType: 'snake', status: 'in_progress' })
    leagueFindUnique.mockResolvedValue({
      settings: { draft_auto_pick_enabled: true, draft_timer_mode: 'per_pick' },
    })

    const out = await processExpiredDraftTimerForLeague('L4', new Date('2026-01-15T12:00:00.000Z'))
    expect(out).toEqual({ outcome: 'skipped_lock_busy', domain: 'pick' })
    expect(reconcile).not.toHaveBeenCalled()
  })
})
