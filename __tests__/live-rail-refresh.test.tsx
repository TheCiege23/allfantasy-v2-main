// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLiveRailScores } from '@/components/core-app/useLiveRailScores'

import { CORE_GAME_DAY_REFRESH_MS, CORE_IDLE_REFRESH_MS } from '@/lib/core-app/coreRefreshPolicy'

const fetchMock = vi.fn()
const leagues = [{ id: 'mine', name: 'League', platform: 'sleeper', mark: 'L' }]
/*
 * Imported rather than retyped: a literal here would keep passing after someone changed the
 * policy, which is the one thing these tests exist to notice.
 */
const GAME_DAY = CORE_GAME_DAY_REFRESH_MS
const IDLE = CORE_IDLE_REFRESH_MS
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', fetchMock)
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ updates: { mine: { yourScore: 12, opponentScore: 20 } }, unavailable: [] }) })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetAllMocks() })
describe('league rail score refresh', () => {
  it('fetches when opened and refreshes both scores on the interval it is given', async () => {
    const { result } = renderHook(() => useLiveRailScores(leagues, true, GAME_DAY))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.scores.mine.yourScore).toBe(12)
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ updates: { mine: { yourScore: 24, opponentScore: 28 } }, unavailable: [] }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(GAME_DAY) })
    expect(result.current.scores.mine).toMatchObject({ yourScore: 24, opponentScore: 28 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it('does not poll a closed rail or hidden page', async () => {
    const { rerender } = renderHook(({ enabled }) => useLiveRailScores(leagues, enabled, GAME_DAY), { initialProps: { enabled: false } })
    await act(async () => { await vi.advanceTimersByTimeAsync(IDLE) })
    expect(fetchMock).not.toHaveBeenCalled()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    rerender({ enabled: true })
    await act(async () => { await vi.advanceTimersByTimeAsync(IDLE) })
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('retains last known numbers but marks failures as delayed', async () => {
    const { result } = renderHook(() => useLiveRailScores(leagues, true, GAME_DAY))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    fetchMock.mockResolvedValue({ ok: false })
    await act(async () => { await vi.advanceTimersByTimeAsync(GAME_DAY) })
    expect(result.current.scores.mine.yourScore).toBe(12)
    expect(result.current.delayed).toEqual(['mine'])
  })
})

/*
 * 🛑 THE POLL IGNORED THE SHELL'S OWN REFRESH POLICY, AND ITS GATE CANNOT SUBSTITUTE FOR ONE.
 *
 * `useLiveRailScores` is enabled on `railOpen` — whether the league list is expanded — which
 * says nothing about whether a game is being played, and on desktop the rail is expanded by
 * DEFAULT (`core-rail-default-open.test.tsx`). At a flat 30s that meant an idle open tab in the
 * offseason fetched twice a minute forever; leagues go eight to a request, so a sixty-league
 * account issued eight requests a poll — roughly 960 an hour, none of which could return a
 * changed score.
 *
 * `coreRefreshIntervalMs` already answered this — 20s while a followed sport is live, 120s
 * otherwise — and the shell's neighbouring effect already says so in a comment: "The rail is a
 * live surface. Refresh the server snapshot while games are on, then back off between slates."
 *
 * ⚠ THESE ASSERT BOTH DIRECTIONS ON PURPOSE. Testing only the quiet side would pass just as
 * happily on a hook that had simply been slowed down, which is a different change and a worse
 * product.
 */
describe('the poll follows the shell refresh policy', () => {
  it('polls on the game-day cadence while a game is live, faster than the old constant', async () => {
    renderHook(() => useLiveRailScores(leagues, true, GAME_DAY))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(GAME_DAY) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    /* The retired flat 30s would not have fired a second time by this point. */
    expect(GAME_DAY).toBeLessThan(30_000)
  })

  it('backs off to the idle cadence between slates', async () => {
    renderHook(() => useLiveRailScores(leagues, true, IDLE))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    /* The window the old constant would have spent four fetches on. */
    await act(async () => { await vi.advanceTimersByTimeAsync(IDLE - 1) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(IDLE).toBeGreaterThan(30_000)
  })

  /*
   * ⚠ THE FLOOR IS NOT DEFENSIVE DECORATION. A caller that omits the argument passes
   * `undefined`, and `setInterval(fn, undefined)` is `setInterval(fn, 0)` — a tight loop against
   * a batched network route. This repo does not typecheck its tests (`tsconfig.json` excludes
   * every spec pattern), so a stale two-argument call in a suite would compile and run.
   */
  it('never polls faster than the floor, whatever it is handed', async () => {
    renderHook(() => useLiveRailScores(leagues, true, undefined as unknown as number))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('treats a nonsense interval as idle rather than as zero', async () => {
    renderHook(() => useLiveRailScores(leagues, true, Number.NaN))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(IDLE - 1) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
