import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Finalizing a dynasty season must not hand next season's creation to a promise nobody waits for.
 *
 * `triggerKeeperOffseason` creates the next season shell and carries every roster into it. It was
 * called without `await`, so a serverless request or cron tick that returned first simply dropped
 * it — and a re-finalize skips that step by design, so nothing ever retried it.
 */

const m = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  finalizeRuntime: vi.fn(),
  enterOffseason: vi.fn(),
  triggerKeeper: vi.fn(),
  ensureNext: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: m.leagueFindUnique } } }))
vi.mock('@/lib/playoff-runtime', () => ({ finalizeNflRedraftPlayoffRuntimeSeason: m.finalizeRuntime }))
vi.mock('@/lib/redraft/offseason/finalizeRotoSeason', () => ({ finalizeRotoSeason: vi.fn() }))
vi.mock('@/lib/redraft/offseason/RedraftOffseasonService', () => ({ enterRedraftOffseason: m.enterOffseason }))
vi.mock('@/lib/keeper/offseasonEngine', () => ({ triggerKeeperOffseason: m.triggerKeeper }))
vi.mock('@/lib/redraft/offseason/startDynastyNewSeason', () => ({ ensureDynastyNextSeason: m.ensureNext }))

import { finalizeSeasonAndEnterOffseason } from '@/lib/redraft/offseason/finalizeSeasonAndEnterOffseason'

const crowned = { ok: true, championRosterId: 'r1', runnerUpRosterId: 'r2', events: [] }
const input = { seasonId: 's1', leagueId: 'l1', actorUserId: 'u1' }

beforeEach(() => {
  vi.clearAllMocks()
  m.enterOffseason.mockResolvedValue({ ok: true, snapshotId: 'snap' })
  m.ensureNext.mockResolvedValue({ id: 's2', season: 2027, playersCarried: 0 })
})

describe('finalizeSeasonAndEnterOffseason — the offseason transition is durable', () => {
  it('does not return until next season has been created (the keeper offseason is awaited)', async () => {
    m.leagueFindUnique.mockResolvedValue({ settings: {}, leagueType: 'dynasty', isDynasty: true })
    m.finalizeRuntime.mockResolvedValue({ ...crowned, alreadyFinalized: false })
    let finished = false
    m.triggerKeeper.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20))
      finished = true
    })

    const out = await finalizeSeasonAndEnterOffseason(input)

    // Unawaited, the call returned while the shell + carryover were still running.
    expect(finished).toBe(true)
    expect(out.ok && out.keeperOffseasonCompleted).toBe(true)
    expect(m.triggerKeeper).toHaveBeenCalledWith('l1', 's1')
  })

  it('a failed keeper offseason is reported, not thrown — the champion still stands', async () => {
    m.leagueFindUnique.mockResolvedValue({ settings: {}, leagueType: 'dynasty', isDynasty: true })
    m.finalizeRuntime.mockResolvedValue({ ...crowned, alreadyFinalized: false })
    m.triggerKeeper.mockRejectedValue(new Error('db down'))

    const out = await finalizeSeasonAndEnterOffseason(input)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.championRosterId).toBe('r1')
    expect(out.keeperOffseasonTriggered).toBe(true)
    expect(out.keeperOffseasonCompleted).toBe(false)
  })

  it('a re-finalize of a dynasty season repairs next season (idempotent shell + carryover)', async () => {
    m.leagueFindUnique.mockResolvedValue({ settings: {}, leagueType: 'dynasty', isDynasty: true })
    m.finalizeRuntime.mockResolvedValue({ ...crowned, alreadyFinalized: true })

    await finalizeSeasonAndEnterOffseason(input)
    expect(m.triggerKeeper).not.toHaveBeenCalled()
    expect(m.ensureNext).toHaveBeenCalledWith('l1', 's1')
  })

  it('a re-finalize of a redraft or keeper season does nothing new', async () => {
    for (const league of [
      { settings: {}, leagueType: 'redraft', isDynasty: false },
      { settings: {}, leagueType: 'keeper', isDynasty: false },
    ]) {
      m.leagueFindUnique.mockResolvedValue(league)
      m.finalizeRuntime.mockResolvedValue({ ...crowned, alreadyFinalized: true })
      await finalizeSeasonAndEnterOffseason(input)
    }
    expect(m.ensureNext).not.toHaveBeenCalled()
    expect(m.triggerKeeper).not.toHaveBeenCalled()
  })
})
