import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

/*
 * The one-tap phone-alerts ask under Chimmy's answer. It must use the shared hook (never its own
 * permission request), show only to someone who has never answered, give iPhone users the step
 * that actually works, and stay away for two weeks after "Not now".
 */

const h = vi.hoisted(() => ({
  state: { supported: true, permission: 'default' as string, subscribed: false, busy: false, error: null as string | null },
  subscribe: vi.fn(),
  keyPassed: [] as Array<string | null | undefined>,
}))

vi.mock('@/lib/push-notifications/useWebPushSubscription', () => ({
  useWebPushSubscription: (key: string | null | undefined) => {
    h.keyPassed.push(key)
    return { ...h.state, subscribe: h.subscribe, unsubscribe: vi.fn() }
  },
}))

import { PUSH_ASK_DISMISSED_KEY, PUSH_ASK_SNOOZE_MS, PushOptInPrompt, pushAskSnoozed } from '@/components/notifications/PushOptInPrompt'

const ASK = /Want this on your phone/

function serverSays(body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => body })))
}
const CONFIGURED = { configured: true, vapidPublicKey: 'BPUBLICKEY' }

beforeEach(() => {
  localStorage.clear()
  h.state = { supported: true, permission: 'default', subscribed: false, busy: false, error: null }
  h.subscribe.mockReset()
  h.keyPassed = []
  serverSays(CONFIGURED)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('PushOptInPrompt', () => {
  it('asks someone who has never answered, and passes the server key to the shared hook before any tap', async () => {
    render(<PushOptInPrompt />)
    await waitFor(() => expect(screen.getByText(ASK)).toBeTruthy())
    expect(h.keyPassed).toContain('BPUBLICKEY')
    expect(h.subscribe).not.toHaveBeenCalled()
  })

  it('one tap turns it on, and says so', async () => {
    h.subscribe.mockResolvedValue(true)
    render(<PushOptInPrompt />)
    await waitFor(() => screen.getByRole('button', { name: 'Turn on alerts' }))
    fireEvent.click(screen.getByRole('button', { name: 'Turn on alerts' }))
    expect(h.subscribe).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByText(/You're set/)).toBeTruthy())
  })

  it('keeps asking if the subscribe did not take, and shows why', async () => {
    h.subscribe.mockResolvedValue(false)
    h.state.error = 'Could not save the subscription.'
    render(<PushOptInPrompt />)
    await waitFor(() => screen.getByRole('button', { name: 'Turn on alerts' }))
    fireEvent.click(screen.getByRole('button', { name: 'Turn on alerts' }))
    await waitFor(() => expect(h.subscribe).toHaveBeenCalled())
    expect(screen.queryByText(/You're set/)).toBeNull()
    expect(screen.getByText('Could not save the subscription.')).toBeTruthy()
  })

  it('"Not now" hides it for two weeks, then it may ask again', async () => {
    render(<PushOptInPrompt />)
    await waitFor(() => screen.getByRole('button', { name: 'Not now' }))
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(screen.queryByText(ASK)).toBeNull()
    const at = Number(localStorage.getItem(PUSH_ASK_DISMISSED_KEY))
    expect(Number.isFinite(at)).toBe(true)

    expect(pushAskSnoozed(String(at), at + PUSH_ASK_SNOOZE_MS - 1)).toBe(true)
    expect(pushAskSnoozed(String(at), at + PUSH_ASK_SNOOZE_MS + 1)).toBe(false)
    expect(pushAskSnoozed(null, at)).toBe(false)
    expect(pushAskSnoozed('garbage', at)).toBe(false)
    // A clock set back must not snooze forever.
    expect(pushAskSnoozed(String(at + 10_000), at)).toBe(false)
  })

  it('stays hidden while snoozed', async () => {
    localStorage.setItem(PUSH_ASK_DISMISSED_KEY, String(Date.now() - 1000))
    render(<PushOptInPrompt />)
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled())
    expect(screen.queryByText(ASK)).toBeNull()
  })

  it('never asks someone who already answered, or a server without push', async () => {
    for (const permission of ['granted', 'denied']) {
      h.state.permission = permission
      const { unmount, container } = render(<PushOptInPrompt />)
      await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled())
      await new Promise((r) => setTimeout(r, 0))
      // Not merely no ask: no box at all — an empty card is still a card.
      expect(container.innerHTML).toBe('')
      unmount()
    }
    h.state.permission = 'default'
    serverSays({ configured: false, vapidPublicKey: null })
    render(<PushOptInPrompt />)
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled())
    expect(screen.queryByText(ASK)).toBeNull()
  })

  it('explains a refusal it just caused', async () => {
    h.state.permission = 'denied'
    h.state.error = 'Notifications are blocked for this site.'
    render(<PushOptInPrompt />)
    await waitFor(() => expect(screen.getByText('Notifications are blocked for this site.')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Turn on alerts' })).toBeNull()
  })

  it('on an iPhone browser tab, gives the Home Screen step instead of a button that cannot work', async () => {
    h.state.supported = false
    h.state.permission = 'unsupported'
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Safari/604.1')
    render(<PushOptInPrompt />)
    await waitFor(() => expect(screen.getByText(/Add to Home Screen/)).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Turn on alerts' })).toBeNull()
  })

  it('recognises an iPad that calls itself a Mac', async () => {
    h.state.supported = false
    h.state.permission = 'unsupported'
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15')
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true })
    render(<PushOptInPrompt />)
    await waitFor(() => expect(screen.getByText(/Add to Home Screen/)).toBeTruthy())
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 0, configurable: true })
  })

  it('says nothing on a desktop browser without push', async () => {
    h.state.supported = false
    h.state.permission = 'unsupported'
    render(<PushOptInPrompt />)
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled())
    expect(screen.queryByText(/Home Screen|Want this/)).toBeNull()
  })
})
