// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLiveRailScores } from '@/components/core-app/useLiveRailScores'

const fetchMock = vi.fn()
const leagues = [{ id: 'mine', name: 'League', platform: 'sleeper', mark: 'L' }]
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', fetchMock)
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ updates: { mine: { yourScore: 12, opponentScore: 20 } }, unavailable: [] }) })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetAllMocks() })
describe('league rail score refresh', () => {
  it('fetches when opened and refreshes both scores every 30 seconds', async () => {
    const { result } = renderHook(() => useLiveRailScores(leagues, true))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.scores.mine.yourScore).toBe(12)
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ updates: { mine: { yourScore: 24, opponentScore: 28 } }, unavailable: [] }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(result.current.scores.mine).toMatchObject({ yourScore: 24, opponentScore: 28 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it('does not poll a closed rail or hidden page', async () => {
    const { rerender } = renderHook(({ enabled }) => useLiveRailScores(leagues, enabled), { initialProps: { enabled: false } })
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(fetchMock).not.toHaveBeenCalled()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    rerender({ enabled: true })
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('retains last known numbers but marks failures as delayed', async () => {
    const { result } = renderHook(() => useLiveRailScores(leagues, true))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    fetchMock.mockResolvedValue({ ok: false })
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(result.current.scores.mine.yourScore).toBe(12)
    expect(result.current.delayed).toEqual(['mine'])
  })
})
