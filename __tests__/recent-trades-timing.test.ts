import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/observability/rootTiming', () => ({ recordCompletedSpan: vi.fn() }))
import { recentTradesTiming } from '@/lib/observability/recentTradesTiming'
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
})
