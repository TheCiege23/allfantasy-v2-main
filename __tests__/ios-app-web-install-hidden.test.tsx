// @vitest-environment jsdom
/**
 * Inside the iOS app (a WKWebView: no Push API, not a Home Screen web app) the web-push card fell
 * into its "iPhone Safari, not installed" branch and told an App Store user to "Tap the Share
 * button, choose Add to Home Screen" — and /core/notifications offered an "Add to Home Screen"
 * button beside it. Seen on the App Review account, 2026-09-29.
 *
 * Every root these components can render carries `data-hide-in-ios-app`, which the pre-paint
 * `html[data-ios-app]` rule hides; the web is unchanged. Each test drives the component into the
 * branch the app actually reaches, so a new root without the attribute fails here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'

vi.mock('@/lib/push-notifications/useWebPushSubscription', () => ({
  useWebPushSubscription: () => ({
    supported: false,
    permission: 'unsupported',
    subscribed: false,
    busy: false,
    error: null,
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  }),
}))
vi.mock('@/lib/pwa', () => ({
  canInstallApp: () => false,
  isInstalled: () => false,
  shareApp: vi.fn(),
  triggerInstall: vi.fn(),
}))

import { EnableWebPushCard } from '@/components/notifications/EnableWebPushCard'
import { InstallButton } from '@/components/pwa/PWAActions'

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 AllFantasyiOS/1.0'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('iOS app: no website-install or web-push prompts', () => {
  it('the web-push card, in the branch the app reaches, is marked hidden-in-app', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE_UA)
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ configured: true, vapidPublicKey: 'k' }) })))
    const { container, findByText } = render(<EnableWebPushCard />)
    // Positive control: this IS the "Add to Home Screen" branch.
    await findByText(/Add to Home Screen/)
    const root = container.firstElementChild
    expect(root?.hasAttribute('data-hide-in-ios-app')).toBe(true)
  })

  it('the "Add to Home Screen" button is marked hidden-in-app', () => {
    const { container, getByText } = render(<InstallButton />)
    getByText('Add to Home Screen')
    expect(container.firstElementChild?.hasAttribute('data-hide-in-ios-app')).toBe(true)
  })
})
