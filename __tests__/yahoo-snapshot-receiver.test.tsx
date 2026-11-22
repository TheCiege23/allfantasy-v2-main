/**
 * The bookmark's receiving window must keep saying "ready" until the Yahoo page answers. Measured on a
 * real league 2026-11-15: a busy Yahoo team page answered only after the window had stopped asking at
 * 20 seconds, so the window sat on "Waiting…" for good while the page was ready to send.
 */
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  YahooSnapshotReceiver,
  YAHOO_READY_GIVE_UP_MS,
  YAHOO_READY_INTERVAL_MS,
  YAHOO_READY_SLOW_HINT_MS,
} from '@/components/core-app/import/YahooSnapshotReceiver'
import {
  YAHOO_FOOTBALL_ORIGIN,
  YAHOO_PAGE_MESSAGE,
  YAHOO_READY_MESSAGE,
} from '@/lib/league-import/yahoo/snapshot/yahooSnapshotBookmarklet'

const sent: Array<{ data: { type: string; rid: string }; origin: string }> = []
const opener = {
  postMessage: (data: { type: string; rid: string }, origin: string) => sent.push({ data: structuredClone(data), origin }),
}
const readyCount = () => sent.filter((m) => m.data.type === YAHOO_READY_MESSAGE).length

beforeEach(() => {
  sent.length = 0
  vi.useFakeTimers()
  Object.defineProperty(window, 'opener', { value: opener, configurable: true })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ error: 'stop here' }), { status: 400 })),
  )
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  Object.defineProperty(window, 'opener', { value: null, configurable: true })
})

function sendPage() {
  const rid = sent[0]!.data.rid
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: YAHOO_FOOTBALL_ORIGIN,
      source: opener as unknown as Window,
      data: { type: YAHOO_PAGE_MESSAGE, url: `${YAHOO_FOOTBALL_ORIGIN}/f1/123/2`, text: 'Roster page', rid },
    }),
  )
}

describe('YahooSnapshotReceiver ready loop', () => {
  it('says ready at once, only to Yahoo, and keeps asking well past the old 20 seconds', () => {
    render(<YahooSnapshotReceiver />)
    expect(readyCount()).toBe(1)
    expect(sent.every((m) => m.origin === YAHOO_FOOTBALL_ORIGIN)).toBe(true)

    act(() => vi.advanceTimersByTime(60_000))
    const at60s = readyCount()
    expect(at60s).toBeGreaterThanOrEqual(60_000 / YAHOO_READY_INTERVAL_MS)
    act(() => vi.advanceTimersByTime(60_000))
    expect(readyCount()).toBeGreaterThan(at60s)
  })

  it('stops asking once the bookmark has stopped listening', () => {
    render(<YahooSnapshotReceiver />)
    act(() => vi.advanceTimersByTime(YAHOO_READY_GIVE_UP_MS))
    const atGiveUp = readyCount()
    act(() => vi.advanceTimersByTime(60_000))
    expect(readyCount()).toBe(atGiveUp)
  })

  it('stops asking the moment the page arrives', () => {
    render(<YahooSnapshotReceiver />)
    act(() => vi.advanceTimersByTime(30_000))
    act(() => sendPage())
    const atArrival = readyCount()
    act(() => vi.advanceTimersByTime(60_000))
    expect(readyCount()).toBe(atArrival)
  })

  it('tells the user what to do when the page is slow, and not before', () => {
    render(<YahooSnapshotReceiver />)
    act(() => vi.advanceTimersByTime(YAHOO_READY_SLOW_HINT_MS - 1))
    expect(screen.queryByText(/Yahoo is still loading that page/)).toBeNull()
    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByText(/click the bookmark again/)).toBeTruthy()
  })

  it('shows no slow hint when the page arrives in time', () => {
    render(<YahooSnapshotReceiver />)
    act(() => vi.advanceTimersByTime(2_000))
    act(() => sendPage())
    act(() => vi.advanceTimersByTime(YAHOO_READY_SLOW_HINT_MS * 2))
    expect(screen.queryByText(/Yahoo is still loading that page/)).toBeNull()
  })
})
