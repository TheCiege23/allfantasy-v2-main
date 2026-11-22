// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The advice ledger's waiver half (2026-11-15): the waiver panel's #1 pickup is recorded, with its
 * suggested drop when that drop can be placed on the user's roster unambiguously.
 */

const recordAdvice = vi.hoisted(() => vi.fn(async () => 'recorded'))
const sportsPlayerFindMany = vi.hoisted(() => vi.fn())
const target = vi.hoisted(() => vi.fn())
vi.mock('server-only', () => ({}))
vi.mock('@/lib/chimmy-advice/adviceStore', () => ({ recordAdvice, WAIVER_PANEL_SURFACE: 'waiver_panel' }))
vi.mock('@/lib/prisma', () => ({ prisma: { sportsPlayer: { findMany: sportsPlayerFindMany } } }))

import type { WaiverClaimRecommendation } from '@/lib/decision-os/waiver/decision'

const claim = (over: Partial<WaiverClaimRecommendation>): WaiverClaimRecommendation => ({
  addPlayerId: 'sp-1',
  addPlayerName: 'Pickup Guy',
  position: 'WR',
  team: 'KC',
  dropPlayerId: null,
  dropPlayerName: 'Bench Guy',
  faabBid: null,
  priorityRank: 1,
  compositeScore: 80,
  recommendation: 'add' as never,
  reason: 'r',
  ...over,
})

describe('resolveDropOnRoster', () => {
  beforeEach(() => sportsPlayerFindMany.mockReset())

  it('places the named drop when exactly one rostered player matches', async () => {
    const { resolveDropOnRoster } = await import('@/lib/chimmy-advice/waiverAdviceTarget')
    sportsPlayerFindMany.mockResolvedValue([{ sleeperId: '11', name: 'Bench Guy' }, { sleeperId: '12', name: 'Other Guy' }])
    expect(await resolveDropOnRoster({ dropName: 'bench guy', rosterIds: new Set(['11', '12']), sport: 'NFL' })).toEqual({ key: '11', name: 'bench guy' })
  })

  it('🛑 two matches or none is null — never a guessed drop', async () => {
    const { resolveDropOnRoster } = await import('@/lib/chimmy-advice/waiverAdviceTarget')
    sportsPlayerFindMany.mockResolvedValue([{ sleeperId: '11', name: 'Bench Guy' }, { sleeperId: '13', name: 'Bench Guy' }])
    expect(await resolveDropOnRoster({ dropName: 'Bench Guy', rosterIds: new Set(['11', '13']), sport: 'NFL' })).toBeNull()
    sportsPlayerFindMany.mockResolvedValue([])
    expect(await resolveDropOnRoster({ dropName: 'Bench Guy', rosterIds: new Set(['11']), sport: 'NFL' })).toBeNull()
    expect(await resolveDropOnRoster({ dropName: null, rosterIds: new Set(['11']), sport: 'NFL' })).toBeNull()
  })
})

describe('recordPanelWaiverAdvice', () => {
  beforeEach(async () => {
    vi.resetModules()
    recordAdvice.mockClear()
    target.mockReset()
    vi.doMock('@/lib/chimmy-advice/waiverAdviceTarget', async () => {
      const real = await vi.importActual<typeof import('@/lib/chimmy-advice/waiverAdviceTarget')>('@/lib/chimmy-advice/waiverAdviceTarget')
      return {
        topWaiverClaim: real.topWaiverClaim,
        resolveWaiverAddTarget: target,
        resolveDropOnRoster: vi.fn(async ({ dropName }: { dropName: string | null }) => (dropName === 'Bench Guy' ? { key: '11', name: 'Bench Guy' } : null)),
      }
    })
  })
  const ok = { ok: true, league: { id: 'lg', sport: 'NFL' }, sleeperId: '9001', playerName: 'Pickup Guy', season: 2026, week: 11, rosterIds: new Set(['11']) }

  it('records the TOP claim as a ledger-only add, with its placed drop as the alternative', async () => {
    target.mockResolvedValue(ok)
    const { recordPanelWaiverAdvice } = await import('@/lib/chimmy-advice/panelWaiverAdvice')
    const out = await recordPanelWaiverAdvice(
      { userId: 'u1', leagueId: 'lg', claims: [claim({ priorityRank: 2, addPlayerName: 'Second' }), claim({})] },
      {} as NodeJS.ProcessEnv,
    )
    expect(out).toBe('recorded')
    expect(target).toHaveBeenCalledWith(expect.objectContaining({ top: expect.objectContaining({ addPlayerName: 'Pickup Guy' }) }))
    expect(recordAdvice).toHaveBeenCalledWith(
      expect.objectContaining({
        adviceType: 'add',
        surface: 'waiver_panel',
        season: 2026,
        week: 11,
        rec: { key: '9001', name: 'Pickup Guy' },
        alt: { key: '11', name: 'Bench Guy' },
        confidencePct: null,
      }),
    )
  })

  it('a drop it cannot place leaves the add plain', async () => {
    target.mockResolvedValue(ok)
    const { recordPanelWaiverAdvice } = await import('@/lib/chimmy-advice/panelWaiverAdvice')
    await recordPanelWaiverAdvice({ userId: 'u1', leagueId: 'lg', claims: [claim({ dropPlayerName: 'Nobody' })] }, {} as NodeJS.ProcessEnv)
    expect(recordAdvice).toHaveBeenCalledWith(expect.objectContaining({ alt: null }))
  })

  it('passes a refusal through and records nothing (not Sleeper, already yours, …)', async () => {
    target.mockResolvedValue({ ok: false, reason: 'already_yours' })
    const { recordPanelWaiverAdvice } = await import('@/lib/chimmy-advice/panelWaiverAdvice')
    expect(await recordPanelWaiverAdvice({ userId: 'u1', leagueId: 'lg', claims: [claim({})] }, {} as NodeJS.ProcessEnv)).toBe('already_yours')
    expect(recordAdvice).not.toHaveBeenCalled()
  })

  it('records the engine’s raw score only when the league is in the calibration scope, and the weekly run under its own surface', async () => {
    target.mockResolvedValue(ok)
    const { recordPanelWaiverAdvice, recordTopWaiverClaim } = await import('@/lib/chimmy-advice/panelWaiverAdvice')
    await recordPanelWaiverAdvice({ userId: 'u1', leagueId: 'lg', claims: [claim({ compositeScore: 83.6 })] }, {} as NodeJS.ProcessEnv)
    expect(recordAdvice).toHaveBeenLastCalledWith(expect.objectContaining({ surface: 'waiver_panel', confidencePct: null }))
    await recordPanelWaiverAdvice({ userId: 'u1', leagueId: 'lg', claims: [claim({ compositeScore: 83.6 })], scored: true }, {} as NodeJS.ProcessEnv)
    expect(recordAdvice).toHaveBeenLastCalledWith(expect.objectContaining({ surface: 'waiver_panel', confidencePct: 84 }))
    await recordTopWaiverClaim({ userId: 'u1', leagueId: 'lg', claims: [claim({ compositeScore: 61 })], scored: true, surface: 'waiver_engine' }, {} as NodeJS.ProcessEnv)
    expect(recordAdvice).toHaveBeenLastCalledWith(expect.objectContaining({ surface: 'waiver_engine', confidencePct: 61 }))
  })

  it('no claim, or the kill switch, records nothing', async () => {
    const { recordPanelWaiverAdvice } = await import('@/lib/chimmy-advice/panelWaiverAdvice')
    expect(await recordPanelWaiverAdvice({ userId: 'u1', leagueId: 'lg', claims: [] }, {} as NodeJS.ProcessEnv)).toBe('no_claim')
    expect(await recordPanelWaiverAdvice({ userId: 'u1', leagueId: 'lg', claims: [claim({})] }, { ADVICE_LEDGER_WAIVERS: 'off' } as NodeJS.ProcessEnv)).toBe('disabled')
    expect(target).not.toHaveBeenCalled()
    expect(recordAdvice).not.toHaveBeenCalled()
  })
})
