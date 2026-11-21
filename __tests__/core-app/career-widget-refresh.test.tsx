/**
 * The iOS career widget refreshes on app open and resume, from any screen (2026-11-20). Before this it
 * moved only when the Career tab was opened, and stamped the profile's BUILD time, so a profile
 * verified current that morning still read "Updated 19 hr ago".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import React from 'react'
import { row } from './careerFixtures'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
const profile = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('@/lib/core-app/careerProfile', () => ({
  readCareerProfile: profile.read,
  loadCareerTradeCounts: vi.fn(async () => []),
  sleeperTradeKeys: vi.fn(async () => []),
}))

import { getCareerWidgetSnapshot } from '@/lib/core-app/careerScreen'
import { RESEND_AFTER_MS, refreshCareerWidget, syncCareerWidget } from '@/lib/platform/careerWidgetBridge'
import { CareerWidgetSync, WIDGET_REFRESH_GAP_MS } from '@/components/platform/CareerWidgetSync'

const IOS_UA = 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 AllFantasyiOS/1.2 AFIAP/1'
const realUA = navigator.userAgent
const setUA = (ua: string) => Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true })

const BUILT = '2026-11-19T21:00:00.000Z'
const NOW = new Date('2026-11-20T16:25:00.000Z')
const rows = [
  row({ season: 2023, isChampion: true, leagueName: 'A' }),
  row({ season: 2026, counted: false, status: 'in_season', leagueName: 'Live', wins: 3, losses: 1 }),
]
profile.read.mockResolvedValue({
  source: { identity: { handle: 'guap', avatarUrl: null, xpTotal: null }, rows, platforms: ['sleeper'], rosterless: 0 },
  trades: [],
  builtAt: BUILT,
  origin: 'stored',
})

let nativePromise: ReturnType<typeof vi.fn>
beforeEach(() => {
  window.sessionStorage.clear()
  setUA(IOS_UA)
  nativePromise = vi.fn().mockResolvedValue({ stored: true })
  ;(window as unknown as { Capacitor: unknown }).Capacitor = { nativePromise }
})
afterEach(() => {
  cleanup()
  setUA(realUA)
  vi.useRealTimers()
  vi.unstubAllGlobals()
  delete (window as unknown as { Capacitor?: unknown }).Capacitor
})

describe('getCareerWidgetSnapshot', () => {
  it('stamps the read time, not the profile build time', async () => {
    const snap = await getCareerWidgetSnapshot('u1', NOW)
    expect(snap).toMatchObject({ handle: 'guap', titles: 1, updatedAt: NOW.toISOString() })
    expect(snap!.updatedAt).not.toBe(BUILT)
  })
})

describe('syncCareerWidget re-sends unchanged data after a while', () => {
  it('skips an identical send soon after, and sends it again once RESEND_AFTER_MS has passed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    const snap = (await getCareerWidgetSnapshot('u1', NOW))!
    expect(await syncCareerWidget(snap)).toBe('sent')
    vi.setSystemTime(NOW.getTime() + RESEND_AFTER_MS - 1000)
    expect(await syncCareerWidget(snap)).toBe('skipped')
    vi.setSystemTime(NOW.getTime() + RESEND_AFTER_MS + 1000)
    expect(await syncCareerWidget(snap)).toBe('sent')
    expect(nativePromise).toHaveBeenCalledTimes(2)
  })
})

describe('refreshCareerWidget', () => {
  it('hands the server snapshot to the widget', async () => {
    const snapshot = await getCareerWidgetSnapshot('u1', NOW)
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ snapshot }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await refreshCareerWidget()).toBe('sent')
    expect(fetchMock).toHaveBeenCalledWith('/api/core/career/widget-snapshot', expect.objectContaining({ cache: 'no-store' }))
    expect(nativePromise).toHaveBeenCalledWith('CareerWidget', 'setSnapshot', { json: JSON.stringify(snapshot) })
  })

  it('leaves the widget alone when signed out or with no career yet', async () => {
    for (const status of [401, 204, 500]) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(status === 204 ? null : '{}', { status })))
      expect(await refreshCareerWidget()).toBe('skipped')
    }
    expect(nativePromise).not.toHaveBeenCalled()
  })

  it('never calls the server outside the iOS app', async () => {
    setUA(realUA)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await refreshCareerWidget()).toBe('skipped')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('CareerWidgetSync', () => {
  const resume = () => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  }

  it('refreshes on open, and again on resume only after the gap', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })

    await act(async () => { render(<CareerWidgetSync />) })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.setSystemTime(NOW.getTime() + 60_000)
    await act(async () => { resume() })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.setSystemTime(NOW.getTime() + WIDGET_REFRESH_GAP_MS + 1000)
    await act(async () => { resume() })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does nothing in a browser', async () => {
    setUA(realUA)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await act(async () => { render(<CareerWidgetSync />) })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
