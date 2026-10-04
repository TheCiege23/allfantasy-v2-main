// @vitest-environment jsdom
/**
 * Signing in never leaves the page in one language and the stored language in another (2026-10-03).
 *
 * SyncProfilePreferences compared a `language` captured before the provider had read localStorage
 * (still the default "en") and then wrote storage directly. With a Spanish browser and an English
 * account, the stale "en" matched the account, `setLanguage` was skipped, and localStorage, the cookie
 * and <html lang> became English under a page that stayed Spanish — found by the My Team session in a
 * live check. These render the REAL provider and the REAL precedence rule
 * (`resolveLanguagePreferenceSync`: the account wins when it has a language).
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime'

const h = vi.hoisted(() => ({ profile: {} as Record<string, unknown>, patches: [] as unknown[] }))

vi.mock('@/components/auth/useOptionalSession', () => ({
  useOptionalSession: () => ({ data: { user: { id: 'u1', email: 'u1@example.test' } }, status: 'authenticated' }),
}))
vi.mock('@/components/theme/ThemeProvider', () => ({ useThemeMode: () => ({ mode: 'dark', setMode: () => {} }) }))
vi.mock('@/lib/preferences/ThemePreferenceService', () => ({
  getStoredThemePreference: () => 'dark',
  setStoredTheme: () => {},
}))

import { LanguageProviderClient, useLanguage } from '@/components/i18n/LanguageProviderClient'
import SyncProfilePreferences from '@/components/auth/SyncProfilePreferences'

const cookieLang = () => document.cookie.match(/(?:^|; )af_lang=([^;]+)/)?.[1] ?? null

function Probe() {
  return <span data-testid="lang">{useLanguage().language}</span>
}

function renderApp() {
  const router = { refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }
  render(
    <AppRouterContext.Provider value={router as never}>
      <LanguageProviderClient>
        <SyncProfilePreferences />
        <Probe />
      </LanguageProviderClient>
    </AppRouterContext.Provider>,
  )
  return router
}

beforeEach(() => {
  h.patches = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      if (url === '/api/user/profile' && init?.method === 'PATCH') {
        h.patches.push(JSON.parse(init.body ?? '{}'))
        return { ok: true, json: async () => ({}) }
      }
      if (url === '/api/user/profile') return { ok: true, json: async () => h.profile }
      return { ok: false, json: async () => null }
    }),
  )
  // A Spanish browser: the reader chose Spanish here, and the server rendered Spanish from the cookie.
  window.localStorage.clear()
  window.localStorage.setItem('af_lang', 'es')
  document.cookie = 'af_lang=es; path=/'
  document.documentElement.dataset.lang = 'es'
  document.documentElement.lang = 'es'
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('profile language sync', () => {
  it('🛑 an English account on a Spanish browser: page, <html lang>, storage and cookie all agree', async () => {
    h.profile = { preferredLanguage: 'en' }
    renderApp()
    await waitFor(() => expect(window.localStorage.getItem('af_lang')).toBe('en'))
    await act(async () => {})
    // The account wins (resolveLanguagePreferenceSync) — and the PAGE follows, not only storage.
    expect(screen.getByTestId('lang').textContent).toBe('en')
    expect(document.documentElement.lang).toBe('en')
    expect(cookieLang()).toBe('en')
  })

  it('an account with no saved language keeps the browser’s Spanish and saves it to the profile', async () => {
    h.profile = {}
    renderApp()
    await waitFor(() => expect(h.patches).toContainEqual(expect.objectContaining({ preferredLanguage: 'es' })))
    expect(screen.getByTestId('lang').textContent).toBe('es')
    expect(document.documentElement.lang).toBe('es')
    expect(window.localStorage.getItem('af_lang')).toBe('es')
    expect(cookieLang()).toBe('es')
  })
})
