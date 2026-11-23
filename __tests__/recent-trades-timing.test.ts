import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/observability/rootTiming', () => ({ recordCompletedSpan: vi.fn() }))
import { recentTradesTiming, ungradedBucket } from '@/lib/observability/recentTradesTiming'
import { BUDGET_UNPRICED_REASON } from '@/lib/decision-os/trade/completedTradeGrade'
afterEach(() => vi.restoreAllMocks())
describe('recent trade diagnostics', () => {
  it('preserves failures while excluding private errors and trade details from logs', async () => {
    let time = 0
    vi.spyOn(performance, 'now').mockImplementation(() => time)
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    const timing = recentTradesTiming(), error = new Error('private-trade-fixture')
    await expect(timing.read('grading', async () => { time = 3100; throw error })).rejects.toBe(error)
    timing.finish()
    expect(log).toHaveBeenCalledWith('[core-trades-timing]', JSON.stringify({ totalMs: 3100, phases: { grading: 3100 } }))
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-trade-fixture')
  })
  it('keeps fast reads quiet and never fails the card when logging fails', async () => {
    let time = 0
    vi.spyOn(performance, 'now').mockImplementation(() => time)
    const log = vi.spyOn(console, 'info').mockImplementation(() => { throw new Error('sink') })
    const timing = recentTradesTiming()
    expect(await timing.read('provider', async () => 42)).toBe(42)
    timing.finish()
    expect(log).not.toHaveBeenCalled()
    time = 3000
    expect(() => timing.finish()).not.toThrow()
  })
  it('adds grade outcome counts to the line, and leaves the line unchanged without them', async () => {
    let time = 0
    vi.spyOn(performance, 'now').mockImplementation(() => time)
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    const timing = recentTradesTiming()
    timing.grade('stored'); timing.grade('stored'); timing.grade('ungraded:unpriced')
    time = 2600
    timing.finish()
    expect(log).toHaveBeenCalledWith('[core-trades-timing]', JSON.stringify({ totalMs: 2600, phases: {}, grades: { stored: 2, 'ungraded:unpriced': 1 } }))
  })
  it('buckets the graders’ real ungraded reasons, and anything unknown as other', () => {
    expect(ungradedBucket('This league’s values could not be loaded just now.')).toBe('noValues')
    expect(ungradedBucket('1 asset has no value on this league’s chart, and a missing asset is not graded as worthless.')).toBe('unpriced')
    expect(ungradedBucket('One side of this trade has no assets recorded.')).toBe('noAssets')
    expect(ungradedBucket('One or more asset values are invalid. Refresh the values before grading this deal.')).toBe('invalidValues')
    expect(ungradedBucket('The priced assets carry no usable value.')).toBe('noUsableValue')
    expect(ungradedBucket('The value gap could not be measured.')).toBe('gapUnmeasured')
    expect(ungradedBucket('only two-team trades are graded — one value gap cannot give three teams a letter each')).toBe('multiTeam')
    expect(ungradedBucket('the trade has no sides on record')).toBe('noSides')
    expect(ungradedBucket('Sam received nothing in return — no player, pick or FAAB on Sleeper’s record — so there is no value gap to grade.')).toBe('giveaway')
    expect(ungradedBucket(BUDGET_UNPRICED_REASON)).toBe('budget')
    expect(ungradedBucket('anything', 'pirate_steal')).toBe('pirateSteal')
    expect(ungradedBucket('a reason nobody has written yet')).toBe('other')
  })
})
