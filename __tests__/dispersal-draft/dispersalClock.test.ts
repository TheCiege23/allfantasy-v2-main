/**
 * The dispersal draft's clock: one server deadline (`pickDeadlineFor`), the auto-pick for whoever is on the clock
 * once it passes (`advanceExpiredPick`), and the every-minute sweep (`processExpiredDispersalPicks`).
 *
 * 🛑 Before this the clock lived only in the on-the-clock manager's page, restarted on every poll, and nothing on
 * the server moved the draft, so a dispersal draft stopped on the first manager who was not watching.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  db: {
    dispersalDraft: { findUnique: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: m.db }))

import { DispersalDraftEngine, pickDeadlineFor } from '@/lib/dispersal-draft/DispersalDraftEngine'
import { processExpiredDispersalPicks } from '@/lib/dispersal-draft/expiredDispersalPicks'

const T0 = new Date('2026-10-27T20:00:00.000Z')
const at = (sec: number) => new Date(T0.getTime() + sec * 1000)
const draft = (over: Record<string, unknown> = {}) => ({
  id: 'd1', leagueId: 'L', status: 'in_progress', autoPickOnTimeout: true, pickTimeSeconds: 120, updatedAt: T0,
  draftOrder: ['rA', 'rB', 'rC'], currentPickIndex: 1, passedRosterIds: [] as string[], picks: [], ...over,
})

beforeEach(() => {
  vi.restoreAllMocks()
  m.db.dispersalDraft.findUnique.mockReset()
  m.db.dispersalDraft.findMany.mockReset()
})

describe('pickDeadlineFor', () => {
  it('is the last write to the draft plus its pick time, and only while it is in progress with a clock', () => {
    expect(pickDeadlineFor(draft())?.toISOString()).toBe(at(120).toISOString())
    expect(pickDeadlineFor(draft({ status: 'pending' }))).toBeNull()
    expect(pickDeadlineFor(draft({ status: 'completed' }))).toBeNull()
    expect(pickDeadlineFor(draft({ pickTimeSeconds: 0 }))).toBeNull()
  })
})

describe('advanceExpiredPick', () => {
  it('before the deadline it writes nothing, whoever asks', async () => {
    const spy = vi.spyOn(DispersalDraftEngine, 'advancePickOnTimeout')
    m.db.dispersalDraft.findUnique.mockResolvedValue(draft())
    expect(await DispersalDraftEngine.advanceExpiredPick('d1', at(119))).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('after it, auto-picks for whoever is on the clock, pinned to that pick', async () => {
    const spy = vi.spyOn(DispersalDraftEngine, 'advancePickOnTimeout').mockResolvedValue({ id: 'd1' } as never)
    m.db.dispersalDraft.findUnique.mockResolvedValue(draft({ passedRosterIds: ['rB'] }))
    expect(await DispersalDraftEngine.advanceExpiredPick('d1', at(120))).toEqual({ id: 'd1' })
    // rB passed out of the draft, so rC is on the clock.
    expect(spy).toHaveBeenCalledWith('d1', 'rC', { expectedPickIndex: 1 })
  })

  it('does nothing when the commissioner turned auto-pick off, or the draft is not running', async () => {
    const spy = vi.spyOn(DispersalDraftEngine, 'advancePickOnTimeout')
    m.db.dispersalDraft.findUnique.mockResolvedValueOnce(draft({ autoPickOnTimeout: false }))
    expect(await DispersalDraftEngine.advanceExpiredPick('d1', at(600))).toBeNull()
    m.db.dispersalDraft.findUnique.mockResolvedValueOnce(draft({ status: 'completed' }))
    expect(await DispersalDraftEngine.advanceExpiredPick('d1', at(600))).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('🛑 a pick made since the clock ran out moves the draft on, and nothing is auto-picked', async () => {
    // Read once at index 1 (expired), then the real pick lands: index 2, the same manager again on the clock.
    m.db.dispersalDraft.findUnique
      .mockResolvedValueOnce(draft({ currentPickIndex: 1, draftOrder: ['rA', 'rB', 'rB'] }))
      .mockResolvedValueOnce(draft({ currentPickIndex: 2, draftOrder: ['rA', 'rB', 'rB'] }))
    await expect(DispersalDraftEngine.advanceExpiredPick('d1', at(200))).rejects.toThrow('Not your pick')
    expect(m.db.$transaction).not.toHaveBeenCalled()
  })
})

describe('processExpiredDispersalPicks', () => {
  it('auto-picks only the drafts whose clock has run out, and a raced pick is not an error', async () => {
    m.db.dispersalDraft.findMany.mockResolvedValue([
      { id: 'expired', status: 'in_progress', pickTimeSeconds: 60, updatedAt: at(-120) },
      { id: 'fresh', status: 'in_progress', pickTimeSeconds: 120, updatedAt: at(-30) },
      { id: 'raced', status: 'in_progress', pickTimeSeconds: 60, updatedAt: at(-90) },
      { id: 'broken', status: 'in_progress', pickTimeSeconds: 60, updatedAt: at(-90) },
    ])
    const spy = vi.spyOn(DispersalDraftEngine, 'advanceExpiredPick').mockImplementation(async (id: string) => {
      if (id === 'raced') throw new Error('Not your pick')
      if (id === 'broken') throw new Error('serialization failure')
      return { id } as never
    })
    const out = await processExpiredDispersalPicks({ now: T0 })
    expect(spy.mock.calls.map((c) => c[0])).toEqual(['expired', 'raced', 'broken'])
    expect(out).toEqual({ scanned: 4, advanced: 1, errors: [{ draftId: 'broken', error: 'serialization failure' }] })
    expect(m.db.dispersalDraft.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'in_progress', autoPickOnTimeout: true, pickTimeSeconds: { gt: 0 } },
    }))
  })
})
