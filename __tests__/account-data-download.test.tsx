import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

/*
 * Settings › Account › Download your data (2026-10-03). The button fetches /api/user/export and
 * hands the file over; a refusal shows its reason, and a partial export says it is partial.
 */

vi.mock('@/hooks/useEntitlements', () => ({
  useEntitlements: () => ({ loading: false, error: null, hasAnyPaid: false, isAdminBypassAccount: false }),
}))
vi.mock('@/lib/pwa/signOutAndPurge', () => ({ signOutAndPurge: vi.fn() }))
vi.mock('@/components/i18n/LanguageProviderClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/i18n/LanguageProviderClient')>()
  return { ...actual, useLanguage: () => actual.defaultLanguageValue }
})

import { AccountSettingsSection } from '@/app/settings/components/sections/AccountSettingsSection'

let clicked: string[] = []
beforeEach(() => {
  clicked = []
  ;(URL as any).createObjectURL = vi.fn(() => 'blob:fake')
  ;(URL as any).revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push(this.download)
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const exportResponse = (unavailableSections: string[] = []) =>
  new Response(JSON.stringify({ version: 2, unavailableSections }), {
    status: 200,
    headers: { 'Content-Disposition': 'attachment; filename="allfantasy-data-2026-10-03.json"' },
  })

function clickDownload() {
  render(<AccountSettingsSection accountCreatedAt={null} planLabel={null} />)
  fireEvent.click(screen.getByTestId('settings-account-data-download'))
}

describe('Download my data', () => {
  it('downloads the file under the server-given name', async () => {
    const fetchMock = vi.fn(async () => exportResponse())
    vi.stubGlobal('fetch', fetchMock)
    clickDownload()
    expect((await screen.findByTestId('settings-account-data-status')).textContent).toMatch(/download has started/i)
    expect(fetchMock).toHaveBeenCalledWith('/api/user/export', { cache: 'no-store' })
    expect(clicked).toEqual(['allfantasy-data-2026-10-03.json'])
  })

  it('says so when the export is partial', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => exportResponse(['tokenLedger'])))
    clickDownload()
    const status = await screen.findByTestId('settings-account-data-status')
    expect(status.textContent).toMatch(/some sections could not be gathered/i)
    expect(status.getAttribute('role')).toBe('alert')
    expect(clicked).toHaveLength(1)
  })

  it('shows the rate-limit reason and downloads nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'COOLDOWN', message: 'Try again in an hour.' }), { status: 429 })),
    )
    clickDownload()
    expect((await screen.findByTestId('settings-account-data-status')).textContent).toBe('Try again in an hour.')
    expect(clicked).toEqual([])
  })

  it('shows a generic error for a failed download, never the raw server code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })))
    clickDownload()
    expect((await screen.findByTestId('settings-account-data-status')).textContent).toMatch(/could not be downloaded/i)
    expect(clicked).toEqual([])
  })
})
