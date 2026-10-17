// @vitest-environment jsdom
/**
 * Settings › Connected Accounts offered Google, Facebook, X, TikTok… as SIGN-IN providers — inside
 * the iOS app, whose login screen hides exactly those because Sign in with Apple is not live
 * (App Store 4.8), and several showed "Not configured": a dead end for App Review. The panel now
 * carries `data-hide-in-ios-app`, which the root CSS hides under `html[data-ios-app]`.
 *
 * Discord and fantasy-platform linking are not sign-in and must stay, so the control asserts the
 * Discord panel is NOT marked — a marker moved to a shared wrapper would hide both.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }))
vi.mock('next-auth/react', () => ({ signIn: vi.fn() }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useLanguage: () => ({ t: (k: string) => k, tInterpolate: (k: string) => k }),
}))
vi.mock('@/lib/connected-accounts', () => ({
  getConnectedAccounts: vi.fn(async () => ({ providers: [], hasPassword: true })),
  disconnectConnectedAccount: vi.fn(),
  getProviderConnectAction: vi.fn(),
  canDisconnectProvider: vi.fn(() => false),
}))
vi.mock('@/components/connected-accounts/ConnectedIdentityRenderer', () => ({ ConnectedIdentityRenderer: () => null }))
vi.mock('@/components/settings/EspnCookieConnection', () => ({ EspnCookieConnection: () => null }))
vi.mock('@/components/settings/MflApiKeyConnection', () => ({ MflApiKeyConnection: () => null }))
vi.mock('@/components/core-app/import/ConnectedPlatforms', () => ({ ConnectedPlatforms: () => null }))

import { ConnectedAccountsSettingsSection } from '@/app/settings/components/sections/ConnectedAccountsSettingsSection'

afterEach(() => cleanup())

function panelOf(container: HTMLElement, label: string): HTMLElement | null {
  const p = [...container.querySelectorAll('p')].find((e) => e.textContent?.trim() === label)
  return (p?.closest('.rounded-xl') as HTMLElement | null) ?? null
}

describe('Settings › Connected Accounts in the iOS app', () => {
  const profile = { discordUserId: null } as never

  it('marks the sign-in providers panel to be hidden in the app', () => {
    const { container } = render(<ConnectedAccountsSettingsSection profile={profile} onRefetchProfile={() => {}} />)
    const panel = panelOf(container, 'settings.connected.signInProviders')
    expect(panel).not.toBeNull()
    expect(panel!.hasAttribute('data-hide-in-ios-app')).toBe(true)
  })

  it('control: the Discord panel stays — it is chat linking, not sign-in', () => {
    const { container } = render(<ConnectedAccountsSettingsSection profile={profile} onRefetchProfile={() => {}} />)
    const panel = panelOf(container, 'settings.connected.discord')
    expect(panel).not.toBeNull()
    expect(panel!.closest('[data-hide-in-ios-app]')).toBeNull()
  })
})
