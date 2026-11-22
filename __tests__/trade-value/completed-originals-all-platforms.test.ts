/**
 * Every completed trade gets one FROZEN ORIGINAL grade, whatever platform it came from (Trade OS, 2026-11-16).
 * The shared batch helper, the native AllFantasy grader on top of it, and Chimmy's native history block.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  frozen: new Map<string, unknown>(),
  saved: [] as unknown[],
  saveOk: true,
  gradeDeal: vi.fn(),
  completedOriginal: vi.fn(),
}))

vi.mock('@/lib/decision-os/trade/frozenCompletedGrade', () => ({
  loadFrozenCompletedGrades: vi.fn(async (_l: string, ids: string[]) => new Map([...h.frozen].filter(([k]) => ids.includes(k)))),
  saveFrozenCompletedGrades: vi.fn(async (_l: string, rows: unknown[]) => {
    if (!h.saveOk) return false
    h.saved.push(...rows)
    return true
  }),
  sleeperTradeKey: (id: string) => String(id).split(':').pop()!.trim(),
}))
vi.mock('@/lib/decision-os/trade/completedTradeGrade', () => ({
  completedTradeGraderFor: vi.fn(async () => ({ grader: true })),
  completedOriginal: h.completedOriginal,
}))
vi.mock('@/lib/decision-os/trade/leagueTradeGrader', () => ({ gradeDeal: h.gradeDeal }))

import { gradeCompletedTradesWithOriginals, type CompletedDeal } from '@/lib/decision-os/trade/completedTradeOriginals'

const player = (name: string) => ({ kind: 'player' as const, name })
const deal = (tradeId: string, over: Partial<CompletedDeal> = {}): CompletedDeal => ({
  tradeId,
  inputs: { give: { assets: [player('A')], unpriceable: [] }, get: { assets: [player('B')], unpriceable: [] } },
  completedAt: '2026-10-01T12:00:00.000Z',
  ...over,
})
const todays = { graded: true, letter: 'B', partnerLetter: 'C', giveValue: 100, getValue: 110 }

beforeEach(() => {
  vi.clearAllMocks()
  h.frozen = new Map()
  h.saved = []
  h.saveOk = true
  h.gradeDeal.mockResolvedValue(todays)
  h.completedOriginal.mockImplementation(async (a: { tradeId: string; frozen: unknown }) =>
    a.frozen
      ? { view: { ...todays, letter: 'A', frozenAt: '2026-10-02' }, toFreeze: null }
      : { view: { ...todays, frozenAt: '2026-11-16' }, toFreeze: { v: 2, tradeId: a.tradeId } },
  )
})

describe('gradeCompletedTradesWithOriginals — any platform', () => {
  it('freezes a first-seen trade from any source and keeps an existing original', async () => {
    h.frozen.set('yahoo-old', { v: 2 })
    const out = await gradeCompletedTradesWithOriginals({
      afLeagueId: 'L',
      deals: [deal('af-uuid-1'), deal('423.l.9.tr.4'), deal('yahoo-old')],
    })
    expect(out.get('yahoo-old')).toMatchObject({ letter: 'A' })
    expect(out.get('af-uuid-1')).toMatchObject({ letter: 'B', frozenAt: '2026-11-16' })
    expect(h.saved).toEqual([{ v: 2, tradeId: 'af-uuid-1' }, { v: 2, tradeId: '423.l.9.tr.4' }])
  })

  it('a failed write shows today’s letter, never one claiming to be an original', async () => {
    h.saveOk = false
    const out = await gradeCompletedTradesWithOriginals({ afLeagueId: 'L', deals: [deal('t1')] })
    expect(out.get('t1')).toEqual(todays)
  })

  it('never grades a deal with an empty side, and freezes nothing for it', async () => {
    const out = await gradeCompletedTradesWithOriginals({
      afLeagueId: 'L',
      deals: [deal('gift', { inputs: { give: { assets: [], unpriceable: [] }, get: { assets: [player('B')], unpriceable: [] } } })],
    })
    expect(out.get('gift')).toMatchObject({ graded: false })
    expect(h.completedOriginal).not.toHaveBeenCalled()
    expect(h.saved).toEqual([])
  })

  it('times a deal by its completion date, and decodes an id as a Sleeper snowflake only when told the ids are Sleeper’s', async () => {
    const snowflakeLike = '1094827364812345678'
    await gradeCompletedTradesWithOriginals({ afLeagueId: 'L', deals: [deal(snowflakeLike, { completedAt: null })] })
    expect(h.completedOriginal.mock.calls[0]![0].tradeAt).toBeNull()

    h.completedOriginal.mockClear()
    await gradeCompletedTradesWithOriginals({ afLeagueId: 'L', sleeperIds: true, deals: [deal(snowflakeLike, { completedAt: null })] })
    expect(h.completedOriginal.mock.calls[0]![0].tradeAt).toBeInstanceOf(Date)

    h.completedOriginal.mockClear()
    await gradeCompletedTradesWithOriginals({ afLeagueId: 'L', deals: [deal('x')] })
    expect(h.completedOriginal.mock.calls[0]![0].tradeAt.toISOString()).toBe('2026-10-01T12:00:00.000Z')
  })

  it('one grader error is that trade’s withheld grade, not the whole list’s', async () => {
    h.gradeDeal.mockRejectedValueOnce(new Error('boom'))
    const out = await gradeCompletedTradesWithOriginals({ afLeagueId: 'L', deals: [deal('bad'), deal('good')] })
    const graded = [...out.values()].filter((v) => (v as { graded: boolean }).graded)
    expect(graded).toHaveLength(1)
    expect([...out.values()].some((v) => (v as { graded: boolean }).graded === false)).toBe(true)
  })
})
