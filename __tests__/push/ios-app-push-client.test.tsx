// @vitest-environment jsdom
/**
 * The iOS app's push opt-in, driven through a fake Capacitor bridge.
 *
 * The case that matters most is the FIRST one below: the website ships before the binary,
 * so the build already on people's phones (and in App Review) loads this code WITHOUT the
 * push plugin compiled in. It must show nothing — not a "Turn on" button that rejects.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import {
  iosAppPushBridge,
  notificationTapHref,
  registerIosDevice,
  resetIosRegistrationForTests,
} from '@/lib/push-notifications/iosAppPushBridge'
import { IosAppPushCard } from '@/components/notifications/IosAppPushCard'

const APP_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 AllFantasyiOS/1.0'
const SAFARI_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1'
const TOKEN = 'A1B2C3D4E5F60718293A4B5C6D7E8F90A1B2C3D4E5F60718293A4B5C6D7E8F90'

type Listener = (data: unknown) => void

function installBridge(opts: {
  withPlugin?: boolean
  permission?: 'prompt' | 'granted' | 'denied'
  afterRequest?: 'prompt' | 'granted' | 'denied'
  onRegister?: 'token' | 'error' | 'silent'
} = {}) {
  const { withPlugin = true, onRegister = 'token' } = opts
  let permission = opts.permission ?? 'prompt'
  const listeners = new Map<string, Set<Listener>>()
  const emit = (event: string, data: unknown) => listeners.get(event)?.forEach((cb) => cb(data))
  const calls: string[] = []

  const cap = {
    PluginHeaders: withPlugin ? [{ name: 'App' }, { name: 'PushNotifications' }] : [{ name: 'App' }],
    nativePromise: vi.fn(async (plugin: string, method: string) => {
      calls.push(`${plugin}.${method}`)
      if (plugin !== 'PushNotifications') throw new Error('unexpected plugin')
      if (method === 'checkPermissions') return { receive: permission }
      if (method === 'requestPermissions') {
        permission = opts.afterRequest ?? 'granted'
        return { receive: permission }
      }
      if (method === 'register') {
        queueMicrotask(() => {
          if (onRegister === 'token') emit('registration', { value: TOKEN })
          if (onRegister === 'error') emit('registrationError', { error: 'no aps-environment' })
        })
        return undefined
      }
      throw new Error(`not implemented: ${method}`)
    }),
    addListener: vi.fn((plugin: string, event: string, cb: Listener) => {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(cb)
      return { remove: () => listeners.get(event)!.delete(cb) }
    }),
  }
  ;(window as unknown as { Capacitor?: unknown }).Capacitor = cap
  return { cap, calls, emit, listenerCount: (e: string) => listeners.get(e)?.size ?? 0 }
}

function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true })
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  resetIosRegistrationForTests()
  setUserAgent(APP_UA)
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/push/ios' && (!init || !init.method || init.method === 'GET')) {
      return new Response(JSON.stringify({ configured: true }), { status: 200 })
    }
    if (url === '/api/push/ios' && init?.method === 'POST') {
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }
    return new Response('{}', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete (window as unknown as { Capacitor?: unknown }).Capacitor
})

const posts = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')

describe('iosAppPushBridge', () => {
  it('is null in an app build WITHOUT the push plugin — the build already in the App Store', () => {
    installBridge({ withPlugin: false })
    expect(iosAppPushBridge()).toBeNull()
  })

  it('is null outside the app, even if a Capacitor object is present', () => {
    installBridge()
    setUserAgent(SAFARI_UA)
    expect(iosAppPushBridge()).toBeNull()
  })

  it('is available in the app when the plugin is compiled in', () => {
    installBridge()
    expect(iosAppPushBridge()).not.toBeNull()
  })
})

describe('registerIosDevice', () => {
  it('stores the token iOS hands back, then removes its listeners', async () => {
    const fake = installBridge()
    const ok = await registerIosDevice(iosAppPushBridge()!)
    expect(ok).toBe(true)
    expect(posts()).toHaveLength(1)
    expect(JSON.parse(String((posts()[0][1] as RequestInit).body))).toEqual({ token: TOKEN })
    expect(fake.listenerCount('registration')).toBe(0)
    expect(fake.listenerCount('registrationError')).toBe(0)
  })

  it('reports failure and stores nothing when iOS refuses (no push entitlement in the build)', async () => {
    installBridge({ onRegister: 'error' })
    expect(await registerIosDevice(iosAppPushBridge()!)).toBe(false)
    expect(posts()).toHaveLength(0)
  })

  it('reports failure when the server refuses the token', async () => {
    installBridge()
    fetchMock.mockImplementation(async () => new Response('{}', { status: 401 }))
    expect(await registerIosDevice(iosAppPushBridge()!)).toBe(false)
  })

  it('shares one attempt between surfaces that ask at the same time', async () => {
    const fake = installBridge()
    const b = iosAppPushBridge()!
    const [a, c] = await Promise.all([registerIosDevice(b), registerIosDevice(b)])
    expect(a && c).toBe(true)
    expect(fake.calls.filter((x) => x === 'PushNotifications.register')).toHaveLength(1)
    expect(posts()).toHaveLength(1)
  })

  it('gives up after a timeout if iOS never answers', async () => {
    vi.useFakeTimers()
    try {
      installBridge({ onRegister: 'silent' })
      const p = registerIosDevice(iosAppPushBridge()!)
      await vi.advanceTimersByTimeAsync(15_001)
      expect(await p).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('notificationTapHref', () => {
  const tap = (href: unknown) => ({ actionId: 'tap', notification: { data: { href } } })
  it('opens a same-origin path', () => {
    expect(notificationTapHref(tap('/core/league/abc?tab=lineup'))).toBe('/core/league/abc?tab=lineup')
  })
  it.each([['https://evil.example/'], ['//evil.example/x'], ['/\\evil.example'], [null], [42]])(
    'refuses %s',
    (href) => {
      expect(notificationTapHref(tap(href))).toBeNull()
    },
  )
})

describe('IosAppPushCard', () => {
  it('renders nothing in a build without the plugin', async () => {
    installBridge({ withPlugin: false })
    const { container } = render(<IosAppPushCard />)
    await act(async () => {})
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing when the server cannot send to Apple', async () => {
    installBridge()
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ configured: false }), { status: 200 }))
    const { container } = render(<IosAppPushCard />)
    await act(async () => {})
    expect(container.innerHTML).toBe('')
  })

  it('asks, registers and says so', async () => {
    const fake = installBridge({ permission: 'prompt' })
    render(<IosAppPushCard />)
    const button = await screen.findByRole('button', { name: 'Turn on' })
    // Nothing is asked of iOS until the user taps.
    expect(fake.calls).not.toContain('PushNotifications.requestPermissions')
    fireEvent.click(button)
    await screen.findByText(/Alerts are on for this iPhone/)
    expect(fake.calls).toContain('PushNotifications.requestPermissions')
    expect(posts()).toHaveLength(1)
  })

  it('points a denied user at iOS Settings and offers no button that cannot work', async () => {
    installBridge({ permission: 'denied' })
    render(<IosAppPushCard />)
    await screen.findByText(/Settings app → Notifications → AllFantasy/)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('re-stores the token silently when permission was already granted', async () => {
    const fake = installBridge({ permission: 'granted' })
    render(<IosAppPushCard />)
    await screen.findByText(/Alerts are on for this iPhone/)
    expect(fake.calls).not.toContain('PushNotifications.requestPermissions')
    await waitFor(() => expect(posts()).toHaveLength(1))
  })
})
