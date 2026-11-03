import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

/*
 * The "turn on phone alerts" sheet after sign-up / sign-in (owner, 2026-10-25). It asks once per
 * visit, "Not now" asks again at a later visit (at most three times), it never interrupts the
 * sign-in screens, and it uses the shared push hooks — never its own permission request.
 */

const h = vi.hoisted(() => ({
  status: 'authenticated' as string,
  pathname: '/core' as string,
  web: { supported: true, permission: 'default' as string, subscribed: false, busy: false, error: null as string | null },
  subscribe: vi.fn(),
  app: { available: false, permission: null as string | null, registered: false, busy: false, error: null as string | null },
  enable: vi.fn(),
}))

vi.mock('next-auth/react', () => ({ useSession: () => ({ status: h.status, data: null }) }))
vi.mock('next/navigation', () => ({ usePathname: () => h.pathname }))
vi.mock('@/lib/push-notifications/useWebPushSubscription', () => ({
  useWebPushSubscription: () => ({ ...h.web, subscribe: h.subscribe, unsubscribe: vi.fn() }),
}))
vi.mock('@/lib/push-notifications/useIosAppPush', () => ({ useIosAppPush: () => ({ ...h.app, enable: h.enable }) }))

import { SignInPushSheet } from '@/components/notifications/SignInPushSheet'
import { CoreWelcomeTour } from '@/components/core-app/CoreWelcomeTour'
import { HomePromptSlot } from '@/components/core-app/HomePromptSlot'
import { resetPushConfigCacheForTests } from '@/components/notifications/PushOptInPrompt'
import {
  ASK_GAP_MS,
  MAX_ASKS,
  SIGN_IN_PUSH_ASK_KEY,
  SIGN_IN_PUSH_ASK_SESSION_KEY,
  isSkippedPath,
  readSignInPushAskState,
  shouldShowSignInPushAsk,
} from '@/lib/push-notifications/signInPushAsk'

const TITLE = /Turn on phone alerts/

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  resetPushConfigCacheForTests()
  h.status = 'authenticated'
  h.pathname = '/core'
  h.web = { supported: true, permission: 'default', subscribed: false, busy: false, error: null }
  h.app = { available: false, permission: null, registered: false, busy: false, error: null }
  h.subscribe.mockReset()
  h.enable.mockReset()
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ configured: true, vapidPublicKey: 'BKEY' }) })))
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('when to ask', () => {
  const now = 1_800_000_000_000
  const ask = (state: { asks: number; lastAskAt: number | null }, extra: Partial<{ askedThisSession: boolean; pathname: string }> = {}) =>
    shouldShowSignInPushAsk({ state, askedThisSession: false, pathname: '/core', now, ...extra })

  it('asks a new account, once per visit', () => {
    expect(ask({ asks: 0, lastAskAt: null })).toBe(true)
    expect(ask({ asks: 0, lastAskAt: null }, { askedThisSession: true })).toBe(false)
  })
  it('"Not now" asks again at a later visit, three times at most', () => {
    expect(ask({ asks: 1, lastAskAt: now - ASK_GAP_MS + 60_000 })).toBe(false)
    expect(ask({ asks: 1, lastAskAt: now - ASK_GAP_MS })).toBe(true)
    expect(ask({ asks: MAX_ASKS, lastAskAt: now - 30 * ASK_GAP_MS })).toBe(false)
  })
  it('never on the sign-in, sign-up or onboarding screens', () => {
    for (const p of ['/login', '/signup', '/signin', '/verify/email', '/onboarding/step-2', '/choose-username']) {
      expect(isSkippedPath(p)).toBe(true)
    }
    expect(isSkippedPath('/core')).toBe(false)
    expect(isSkippedPath('/loginx')).toBe(false)
  })
  it('reads broken storage as never asked', () => {
    expect(readSignInPushAskState('{not json')).toEqual({ asks: 0, lastAskAt: null })
    expect(readSignInPushAskState(null)).toEqual({ asks: 0, lastAskAt: null })
  })
})

describe('the sheet', () => {
  it('keeps keyboard focus in the alert prompt and supports Escape to reveal the guide', async () => {
    render(<><HomePromptSlot enabled><CoreWelcomeTour leagueCount={1} /></HomePromptSlot><SignInPushSheet /></>)
    const sheet = await screen.findByTestId('signin-push-sheet')
    const enable = screen.getByRole('button', { name: 'Turn on alerts' })
    const later = screen.getByRole('button', { name: 'Not now' })
    await waitFor(() => expect(document.activeElement).toBe(enable))
    fireEvent.keyDown(sheet, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(later)
    fireEvent.keyDown(sheet, { key: 'Tab' })
    expect(document.activeElement).toBe(enable)
    fireEvent.keyDown(sheet, { key: 'Escape' })
    expect(await screen.findByRole('region', { name: '1 league ready' })).toBeTruthy()
    expect(screen.queryByTestId('signin-push-sheet')).toBeNull()
  })

  it('defers the welcome guide until alerts are dismissed, then shows readable guide actions', async () => {
    render(<><HomePromptSlot enabled><CoreWelcomeTour leagueCount={1} /></HomePromptSlot><SignInPushSheet /></>)
    await screen.findByTestId('signin-push-sheet')
    expect(screen.queryByRole('region', { name: '1 league ready' })).toBeNull()
    fireEvent.click(screen.getByText('Not now'))
    expect(await screen.findByRole('region', { name: '1 league ready' })).toBeTruthy()
    expect(screen.getByText(/league switcher at the top/)).toBeTruthy()
    expect(localStorage.getItem('af-core-welcome-v1')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Close guide' }))
    expect(localStorage.getItem('af-core-welcome-v1')).toBe('done')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows after sign-in, and counts the ask', async () => {
    render(<SignInPushSheet />)
    await waitFor(() => expect(screen.getByText(TITLE)).toBeTruthy())
    expect(sessionStorage.getItem(SIGN_IN_PUSH_ASK_SESSION_KEY)).toBe('1')
    expect(readSignInPushAskState(localStorage.getItem(SIGN_IN_PUSH_ASK_KEY)).asks).toBe(1)
    expect(screen.getByText(/turn them off any time in Settings/)).toBeTruthy()
  })

  it('"Turn on alerts" goes through the shared hook and stops future asks', async () => {
    h.subscribe.mockResolvedValue(true)
    render(<SignInPushSheet />)
    fireEvent.click(await screen.findByText('Turn on alerts'))
    await waitFor(() => expect(screen.getByText("You're set")).toBeTruthy())
    expect(h.subscribe).toHaveBeenCalledTimes(1)
    expect(readSignInPushAskState(localStorage.getItem(SIGN_IN_PUSH_ASK_KEY)).asks).toBe(MAX_ASKS)
  })

  it('"Not now" closes it, and it does not come back in the same visit', async () => {
    const first = render(<SignInPushSheet />)
    fireEvent.click(await screen.findByText('Not now'))
    expect(screen.queryByText(TITLE)).toBeNull()
    first.unmount()
    render(<SignInPushSheet />)
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByText(TITLE)).toBeNull()
  })

  it.each([
    ['signed out', () => { h.status = 'unauthenticated' }],
    ['on the sign-in screen', () => { h.pathname = '/login' }],
    ['already allowed', () => { h.web.permission = 'granted' }],
    ['already blocked', () => { h.web.permission = 'denied' }],
  ])('stays away when %s', async (_label, setup) => {
    setup()
    render(<SignInPushSheet />)
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByText(TITLE)).toBeNull()
    expect(localStorage.getItem(SIGN_IN_PUSH_ASK_KEY)).toBeNull()
  })

  it('stays away when the server has no push keys', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ configured: false, vapidPublicKey: null }) })))
    render(<SignInPushSheet />)
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByText(TITLE)).toBeNull()
  })

  it('inside the iOS app it uses the app permission flow', async () => {
    h.web.supported = false
    h.web.permission = 'unsupported'
    h.app = { available: true, permission: 'prompt', registered: false, busy: false, error: null }
    render(<SignInPushSheet />)
    fireEvent.click(await screen.findByText('Turn on alerts'))
    expect(h.enable).toHaveBeenCalledTimes(1)
    expect(h.subscribe).not.toHaveBeenCalled()
  })
})
