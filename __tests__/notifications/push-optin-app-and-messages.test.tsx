import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

/*
 * "Look into the notification opt-in" (owner, 2026-10-02). Measured that day: every DM alert was
 * dispatched, and only 3 of 132 users had any device that could receive a push.
 *
 * Two gaps, both pinned here:
 *  1. Nothing asked where messages live. The one-tap ask sat under Chimmy and the Career feed only.
 *  2. Inside the iOS app the ask was HIDDEN (`data-hide-in-ios-app`, because it is web push), and
 *     the app's own permission flow was only offered on settings-style screens.
 */

const h = vi.hoisted(() => ({
  web: { supported: false, permission: 'unsupported' as string, subscribed: false, busy: false, error: null as string | null },
  subscribe: vi.fn(),
  app: {
    available: false,
    permission: null as null | 'prompt' | 'granted' | 'denied',
    registered: false,
    busy: false,
    error: null as string | null,
  },
  enable: vi.fn(),
  appOptions: [] as unknown[],
}))

vi.mock('@/lib/push-notifications/useWebPushSubscription', () => ({
  useWebPushSubscription: () => ({ ...h.web, subscribe: h.subscribe, unsubscribe: vi.fn() }),
}))
vi.mock('@/lib/push-notifications/useIosAppPush', () => ({
  useIosAppPush: (opts: unknown) => {
    h.appOptions.push(opts)
    return { ...h.app, enable: h.enable }
  },
}))

import { PUSH_ASK_DISMISSED_KEY, PushOptInPrompt, resetPushConfigCacheForTests } from '@/components/notifications/PushOptInPrompt'

beforeEach(() => {
  localStorage.clear()
  resetPushConfigCacheForTests()
  h.web = { supported: false, permission: 'unsupported', subscribed: false, busy: false, error: null }
  h.app = { available: false, permission: null, registered: false, busy: false, error: null }
  h.enable.mockReset()
  h.subscribe.mockReset()
  h.appOptions = []
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ configured: true, vapidPublicKey: 'BKEY' }) })))
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('inside the iOS app', () => {
  it("asks with the app's own permission flow — and is NOT hidden in the app", async () => {
    h.app = { ...h.app, available: true, permission: 'prompt' }
    const { container } = render(<PushOptInPrompt variant="messages" />)
    const ask = await screen.findByText(/ping on your phone when someone messages you/)
    expect(container.querySelector('[data-hide-in-ios-app]')).toBeNull()
    expect(ask).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Turn on alerts' }))
    expect(h.enable).toHaveBeenCalledTimes(1)
    expect(h.subscribe).not.toHaveBeenCalled()
  })

  it('says it worked once iOS granted and the phone is stored', async () => {
    h.app = { ...h.app, available: true, permission: 'prompt' }
    const view = render(<PushOptInPrompt variant="messages" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on alerts' }))
    h.app = { ...h.app, permission: 'granted', registered: true }
    view.rerender(<PushOptInPrompt variant="messages" />)
    expect(screen.getByText(/New messages will ping this device/)).toBeTruthy()
  })

  it('a refusal it just caused is explained, with where to undo it', async () => {
    h.app = { ...h.app, available: true, permission: 'prompt' }
    const view = render(<PushOptInPrompt variant="messages" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on alerts' }))
    h.app = { ...h.app, permission: 'denied' }
    view.rerender(<PushOptInPrompt variant="messages" />)
    expect(screen.getByText(/Settings app → Notifications → AllFantasy/)).toBeTruthy()
  })

  it('never re-asks someone who already answered — iOS only shows its prompt once', () => {
    for (const permission of ['granted', 'denied'] as const) {
      h.app = { ...h.app, available: true, permission }
      const { container, unmount } = render(<PushOptInPrompt variant="messages" />)
      expect(container.textContent, permission).toBe('')
      unmount()
    }
  })

  it('"Not now" is shared with the web ask', async () => {
    localStorage.setItem(PUSH_ASK_DISMISSED_KEY, String(Date.now()))
    h.app = { ...h.app, available: true, permission: 'prompt' }
    const { container } = render(<PushOptInPrompt variant="messages" />)
    await waitFor(() => expect(container.textContent).toBe(''))
  })

  it('reads the permission WITHOUT re-sending the token — the root registrar already does that', () => {
    render(<PushOptInPrompt variant="messages" />)
    expect(h.appOptions[0]).toEqual({ registerOnMount: false })
  })
})

describe('in a browser', () => {
  it('the messages ask uses the shared web flow, unchanged', async () => {
    h.web = { ...h.web, supported: true, permission: 'default' }
    h.subscribe.mockResolvedValue(true)
    render(<PushOptInPrompt variant="messages" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on alerts' }))
    expect(h.subscribe).toHaveBeenCalledTimes(1)
    expect(h.enable).not.toHaveBeenCalled()
  })
})

describe('where it is mounted', () => {
  it('an open DM or huddle carries the messages ask', () => {
    const src = readFileSync(join(process.cwd(), 'components/core-app/comms/ThreadPanel.tsx'), 'utf8')
    expect(src).toMatch(/<PushOptInPrompt\s+variant="messages"/)
  })
})
