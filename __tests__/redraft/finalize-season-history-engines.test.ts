/**
 * Finalizing a native season fills the record book and runs the season awards — best-effort.
 *
 * Both engines existed but were only ever run by hand, so a native league's record book and
 * awards stayed empty even once `SeasonResult` was written. They now run after the offseason is
 * entered; a failure in either must never fail the finalize, because the champion and archive
 * are already committed by then.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  finalizeRuntime: vi.fn(),
  enterOffseason: vi.fn(),
  recordBook: vi.fn(),
  awards: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: m.leagueFindUnique } } }))
vi.mock('@/lib/playoff-runtime', () => ({ finalizeNflRedraftPlayoffRuntimeSeason: m.finalizeRuntime }))
vi.mock('@/lib/redraft/offseason/finalizeRotoSeason', () => ({ finalizeRotoSeason: vi.fn() }))
vi.mock('@/lib/redraft/offseason/RedraftOffseasonService', () => ({ enterRedraftOffseason: m.enterOffseason }))
vi.mock('@/lib/keeper/offseasonEngine', () => ({ triggerKeeperOffseason: vi.fn() }))
vi.mock('@/lib/redraft/offseason/startDynastyNewSeason', () => ({ ensureDynastyNextSeason: vi.fn() }))
vi.mock('@/lib/commissioner/CommissionerRatingTrigger', () => ({ triggerCommissionerRatingPrompt: vi.fn() }))
vi.mock('@/lib/constitution/constitutionService', () => ({
  applyAmendmentsAtSeasonRollover: vi.fn(async () => ({ applied: 0, failed: 0 })),
}))
vi.mock('@/lib/record-book-engine/RecordBookEngine', () => ({ runRecordBookEngine: m.recordBook }))
vi.mock('@/lib/awards-engine/AwardsEngine', () => ({ runAwardsEngine: m.awards }))

import { finalizeSeasonAndEnterOffseason } from '@/lib/redraft/offseason/finalizeSeasonAndEnterOffseason'

const input = { seasonId: 's1', leagueId: 'l1', actorUserId: 'u1' }

beforeEach(() => {
  vi.clearAllMocks()
  m.leagueFindUnique.mockResolvedValue({ settings: {}, leagueType: 'redraft', isDynasty: false, sport: 'NBA' })
  m.finalizeRuntime.mockResolvedValue({ ok: true, alreadyFinalized: false, championRosterId: 'r1', runnerUpRosterId: 'r2', events: [] })
  m.enterOffseason.mockResolvedValue({ ok: true, snapshotId: 'snap', alreadyInOffseason: false, season: 2026 })
  m.recordBook.mockResolvedValue({ created: 1, updated: 0 })
  m.awards.mockResolvedValue({ awards: [] })
})

describe('finalizeSeasonAndEnterOffseason — record book and awards', () => {
  it('runs both engines for the league and the archived season, with the league sport', async () => {
    const out = await finalizeSeasonAndEnterOffseason(input)
    expect(out.ok).toBe(true)
    expect(m.recordBook).toHaveBeenCalledWith('l1', ['2026'], { sport: 'NBA' })
    expect(m.awards).toHaveBeenCalledWith('l1', '2026', { sport: 'NBA' })
  })

  it('a throwing record book engine does not fail the finalize, and awards still run', async () => {
    m.recordBook.mockRejectedValue(new Error('db down'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = await finalizeSeasonAndEnterOffseason(input)
    expect(out).toMatchObject({ ok: true, offseasonEntered: true, championRosterId: 'r1', offseasonSnapshotId: 'snap' })
    expect(m.awards).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('a throwing awards engine does not fail the finalize', async () => {
    m.awards.mockRejectedValue(new Error('db down'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = await finalizeSeasonAndEnterOffseason(input)
    expect(m.awards).toHaveBeenCalledTimes(1)
    expect(out).toMatchObject({ ok: true, offseasonEntered: true })
    expect(warn).toHaveBeenCalledWith('[finalize-season] awards engine failed', expect.objectContaining({ leagueId: 'l1', season: '2026' }))
    warn.mockRestore()
  })

  it('does not run the engines when the offseason was not entered', async () => {
    m.enterOffseason.mockResolvedValue({ ok: false, code: 'LEAGUE_NOT_COMPLETED' })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await finalizeSeasonAndEnterOffseason(input)
    expect(m.recordBook).not.toHaveBeenCalled()
    expect(m.awards).not.toHaveBeenCalled()
    error.mockRestore()
  })
})
