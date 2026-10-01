import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { LanguageProviderClient, useLanguage } from '@/components/i18n/LanguageProviderClient'

function Label() {
  const { t } = useLanguage()
  return <span>{t('common.signIn')}</span>
}

afterEach(() => vi.unstubAllGlobals())

it('keeps bundled Spanish when the remote dictionary omits a key', async () => {
  window.localStorage.setItem('af_lang', 'es')
  let respond!: (value: { ok: boolean; json: () => Promise<{ messages: Record<string, string> }> }) => void
  vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { respond = resolve })))
  render(<LanguageProviderClient><Label /></LanguageProviderClient>)
  await waitFor(() => expect(screen.getByText('Iniciar sesión')).toBeTruthy())
  await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/i18n/translations?lang=es', { cache: 'no-store' }))
  await act(async () => { respond({ ok: true, json: async () => ({ messages: {} }) }) })
  expect(screen.getByText('Iniciar sesión')).toBeTruthy()
})
