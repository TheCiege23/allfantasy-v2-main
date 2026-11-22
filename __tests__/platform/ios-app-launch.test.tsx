import React from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_START_TARGET, shouldSendIosLaunchToAppStart } from '@/lib/platform/iosAppLaunch'

/*
 * 🛑 The iOS app reopened onto a blue screen for the 10-18s /core took to build (2026-11-20). Its
 * launch load of /core now goes to /app-start, which paints at once and fetches /core behind it.
 */
const APP_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 AllFantasyiOS/1.1 AFIAP/1'
const SAFARI_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1'
const send = (pathname: string, search: string, headers: Record<string, string>) =>
  shouldSendIosLaunchToAppStart({ pathname, search, headers: new Headers(headers) })

describe('which requests go to /app-start', () => {
  it('the app opening bare /core as a page', () => {
    expect(send('/core', '', { 'user-agent': APP_UA, 'sec-fetch-dest': 'document' })).toBe(true)
    expect(send('/core', '', { 'user-agent': APP_UA })).toBe(true) // older iOS sends no Sec-Fetch headers
  })

  it('🛑 never the /core that /app-start itself loads — that would loop', () => {
    expect(APP_START_TARGET).toContain('?')
    const [path, query] = APP_START_TARGET.split('?')
    expect(send(path!, `?${query}`, { 'user-agent': APP_UA, 'sec-fetch-dest': 'document' })).toBe(false)
  })

  it('not a deep link, another screen, a browser, or an in-app navigation', () => {
    expect(send('/core', '?league=abc', { 'user-agent': APP_UA })).toBe(false)
    expect(send('/core/trades', '', { 'user-agent': APP_UA })).toBe(false)
    expect(send('/core', '', { 'user-agent': SAFARI_UA, 'sec-fetch-dest': 'document' })).toBe(false)
    expect(send('/core', '', { 'user-agent': APP_UA, rsc: '1' })).toBe(false)
    expect(send('/core', '', { 'user-agent': APP_UA, 'next-router-prefetch': '1' })).toBe(false)
    expect(send('/core', '', { 'user-agent': APP_UA, 'sec-fetch-dest': 'empty' })).toBe(false)
  })
})

const nav = vi.hoisted(() => ({ replace: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: nav.replace, push: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }) }))
import { AppStartClient, APP_START_FALLBACK_MS } from '@/app/app-start/AppStartClient'

describe('the /app-start screen', () => {
  const realLocation = window.location
  const hardReplace = vi.fn()
  beforeEach(() => {
    vi.useFakeTimers()
    nav.replace.mockClear()
    hardReplace.mockClear()
    Object.defineProperty(window, 'location', { configurable: true, value: { ...realLocation, replace: hardReplace } })
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
  })

  it('says it is loading and fetches /core behind the screen', () => {
    const { getByRole } = render(<AppStartClient text="Loading your leagues…" />)
    expect(getByRole('status').textContent).toContain('Loading your leagues…')
    expect(getByRole('status').querySelector('svg')).not.toBeNull()
    expect(nav.replace).toHaveBeenCalledWith(APP_START_TARGET)
    expect(hardReplace).not.toHaveBeenCalled()
  })

  it('falls back to loading /core as a page if the swap never happens', () => {
    render(<AppStartClient text="Loading your leagues…" />)
    act(() => void vi.advanceTimersByTime(APP_START_FALLBACK_MS))
    expect(hardReplace).toHaveBeenCalledWith(APP_START_TARGET)
  })
})
