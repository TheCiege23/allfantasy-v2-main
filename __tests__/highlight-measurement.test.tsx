import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const beacon = vi.hoisted(() => vi.fn())
vi.mock('@/lib/analytics/client', () => ({ sendProductAnalyticsBeacon: beacon }))
import RecentClips from '@/components/core-app/highlights/RecentClips'
import { HIGHLIGHTS } from '@/lib/analytics/highlights'
let callbacks: IntersectionObserverCallback[]
const fetchMock = vi.fn()
const post = { id: '2109403783620857925', account: 'MySportsUpdate', text: 'Cam Ward interview', kind: 'interview', publishedAt: new Date().toISOString(), players: [{ id: 'private-player', name: 'Cam Ward' }], leagues: [{ id: 'private-league', name: 'Private league' }] }
const result = (status = 'ready', clips: unknown[] = [post]) => ({ ok: true, json: async () => ({ status, clips, checkedAt: null }) })
const renderFeed = () => render(<RecentClips title="Clips" request={{ kind: 'roster', playerIds: ['private-player'] }} />)
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve() }) }
function visible(ratio = 1) { act(() => callbacks.at(-1)?.([{ isIntersecting: ratio > 0, intersectionRatio: ratio }] as IntersectionObserverEntry[], {} as IntersectionObserver)) }
function advance(ms: number) { act(() => vi.advanceTimersByTime(ms)) }
beforeEach(() => {
  vi.useFakeTimers(); beacon.mockReset(); fetchMock.mockReset(); callbacks = []
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('IntersectionObserver', class {
    constructor(cb: IntersectionObserverCallback) { callbacks.push(cb) }
    observe() {} disconnect() {}
  })
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  ;(window as unknown as { twttr: unknown }).twttr = { widgets: { createTweet: vi.fn().mockResolvedValue(document.createElement('div')) } }
  fetchMock.mockResolvedValue(result())
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })
describe('highlight exposure and engagement', () => {
  it('requires continuous visible dwell in an active tab and counts only once across filters', async () => {
    renderFeed(); await flush(); advance(2000); expect(beacon).not.toHaveBeenCalled()
    visible(); advance(600); visible(0); advance(1000); expect(beacon).not.toHaveBeenCalled()
    visible(); Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    act(() => document.dispatchEvent(new Event('visibilitychange'))); advance(2000); expect(beacon).not.toHaveBeenCalled()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    act(() => document.dispatchEvent(new Event('visibilitychange'))); advance(999); expect(beacon).not.toHaveBeenCalled(); advance(1)
    expect(beacon).toHaveBeenCalledWith(HIGHLIGHTS.VIEW, expect.objectContaining({ surface: 'my_team', status: 'clips', clipCount: 1, visibility: 'header' }))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'play' } }); visible(); advance(2000)
    expect(beacon).toHaveBeenCalledTimes(1); expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('links explicit actions to one exposure without transmitting clip, player, league or caption data', async () => {
    renderFeed(); await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Load X post' })); await flush()
    fireEvent.click(screen.getByRole('link', { name: /Watch on X/ })); fireEvent.click(screen.getByRole('link', { name: /Watch on X/ }))
    expect(beacon.mock.calls.map(c => c[0])).toEqual([HIGHLIGHTS.VIEW, HIGHLIGHTS.LOAD, HIGHLIGHTS.READY, HIGHLIGHTS.SOURCE])
    const ids = beacon.mock.calls.map(c => c[1].viewId); expect(new Set(ids).size).toBe(1)
    const payload = JSON.stringify(beacon.mock.calls)
    for (const secret of [post.id, post.text, 'private-player', 'private-league', 'Private league', 'Cam Ward']) expect(payload).not.toContain(secret)
    expect(payload).not.toMatch(/playback|completion|watch_time/)
  })
  it('does not count disabled or abandoned requests and resets on identity changes', async () => {
    fetchMock.mockResolvedValueOnce(result('disabled', []))
    const view = renderFeed(); await flush(); advance(2000); expect(beacon).not.toHaveBeenCalled()
    view.rerender(<RecentClips title="Clips" request={{ kind: 'player', sport: 'NFL', sleeperId: 'other' }} />)
    await flush(); visible(); advance(1000)
    expect(beacon).toHaveBeenCalledWith(HIGHLIGHTS.VIEW, expect.objectContaining({ surface: 'player_card' }))
    const first = beacon.mock.calls[0][1].viewId
    view.rerender(<RecentClips title="Clips" request={{ kind: 'player', sport: 'NFL', sleeperId: 'new' }} />)
    await flush(); visible(); advance(1000); expect(beacon.mock.calls[1][1].viewId).not.toBe(first)
    view.unmount(); advance(5000); expect(beacon).toHaveBeenCalledTimes(2)
  })
  it.each(['empty', 'unavailable', 'error'])('records visible %s honestly and keeps playback unknown', async status => {
    if (status === 'error') fetchMock.mockRejectedValueOnce(new Error('offline'))
    else fetchMock.mockResolvedValueOnce(result(status === 'empty' ? 'ready' : status, []))
    renderFeed(); await flush(); visible(); advance(1000)
    expect(beacon).toHaveBeenCalledWith(HIGHLIGHTS.VIEW, expect.objectContaining({ status, clipCount: 0 }))
    expect(beacon).toHaveBeenCalledTimes(1)
  })
  it('reports failed embed separately and retains the source fallback', async () => {
    ;(window as unknown as { twttr: unknown }).twttr = { widgets: { createTweet: vi.fn().mockResolvedValue(undefined) } }
    renderFeed(); await flush(); fireEvent.click(screen.getByRole('button', { name: 'Load X post' })); await flush()
    expect(beacon.mock.calls.map(c => c[0])).toEqual([HIGHLIGHTS.VIEW, HIGHLIGHTS.LOAD, HIGHLIGHTS.ERROR])
    expect(screen.getByRole('link', { name: /Watch on X/ })).toBeTruthy()
  })
})
