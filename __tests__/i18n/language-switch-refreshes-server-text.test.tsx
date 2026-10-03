// @vitest-environment jsdom
/**
 * A language switch re-renders the SERVER's text, not only the client's (2026-10-03).
 *
 * Switching set client state only, so every string a server component or a /core loader wrote kept
 * the old language until the next navigation. The provider now writes the cookie and calls
 * `router.refresh()` on every real switch. These render the REAL provider inside a fake App Router.
 */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import { LanguageProviderClient, useLanguage } from '@/components/i18n/LanguageProviderClient'

const cookieLang = () => document.cookie.match(/(?:^|; )af_lang=([^;]+)/)?.[1] ?? null

let refresh: ReturnType<typeof vi.fn>
/** The cookie's value at the moment each refresh ran — the refresh must SEE the new language. */
let cookieAtRefresh: Array<string | null>

function withRouter(children: ReactNode) {
  const router = { refresh, push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }
  return <AppRouterContext.Provider value={router as never}>{children}</AppRouterContext.Provider>
}

let api: ReturnType<typeof useLanguage>
function Probe() {
  api = useLanguage()
  return <span data-testid="lang">{api.language}</span>
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => null })))
  cookieAtRefresh = []
  refresh = vi.fn(() => cookieAtRefresh.push(cookieLang()))
  window.localStorage.clear()
  document.cookie = 'af_lang=; path=/; max-age=0'
  document.documentElement.dataset.lang = 'en'
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('language switch refreshes server-rendered text', () => {
  it('🛑 en → es → en: each real switch refreshes once, with the new cookie already written', async () => {
    render(withRouter(<LanguageProviderClient><Probe /></LanguageProviderClient>))
    expect(refresh).not.toHaveBeenCalled() // nothing to align on a clean load

    act(() => api.setLanguage('es'))
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(cookieAtRefresh).toEqual(['es'])

    act(() => api.setLanguage('en'))
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(cookieAtRefresh).toEqual(['es', 'en'])
  })

  it('choosing the language already showing does not refresh', async () => {
    render(withRouter(<LanguageProviderClient><Probe /></LanguageProviderClient>))
    act(() => api.setLanguage('en'))
    expect(refresh).not.toHaveBeenCalled()
  })

  it('another tab’s switch refreshes this tab too', async () => {
    render(withRouter(<LanguageProviderClient><Probe /></LanguageProviderClient>))
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'af_lang', newValue: 'es' }))
    })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('a stored language that disagrees with the cookie is aligned, and refreshed ONCE', async () => {
    // The server rendered English (cookie / data-lang), the reader last chose Spanish here.
    window.localStorage.setItem('af_lang', 'es')
    render(withRouter(<LanguageProviderClient><Probe /></LanguageProviderClient>))
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(cookieAtRefresh).toEqual(['es'])
  })

  it('a stored language that matches the cookie does not refresh', async () => {
    window.localStorage.setItem('af_lang', 'en')
    render(withRouter(<LanguageProviderClient><Probe /></LanguageProviderClient>))
    expect(refresh).not.toHaveBeenCalled()
  })

  it('with no App Router mounted it switches without throwing (tests, bare renders)', async () => {
    render(<LanguageProviderClient><Probe /></LanguageProviderClient>)
    expect(() => act(() => api.setLanguage('es'))).not.toThrow()
    expect(cookieLang()).toBe('es')
  })
})
