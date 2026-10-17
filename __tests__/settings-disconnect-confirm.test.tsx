// @vitest-environment jsdom
/**
 * Disconnects in Settings › Connected Accounts confirm in-app (ConfirmDialog), not with
 * window.confirm — which some embedded webviews and in-app browsers suppress, so the action could
 * never happen there, or happened with no question asked. Nothing is sent until the user confirms.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }))
vi.mock('next-auth/react', () => ({ signIn: vi.fn() }))
// The real English copy (not an identity t()), so these assertions read what a user sees.
vi.mock('@/components/i18n/LanguageProviderClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/i18n/LanguageProviderClient')>()
  return { ...actual, useLanguage: () => actual.defaultLanguageValue }
})
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

const PROFILE = { discordUserId: '123456789012345678', discordUsername: 'guap#0001', discordConnectedAt: '2026-01-01' } as never

function setup() {
  const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  const confirmSpy = vi.spyOn(window, 'confirm')
  render(<ConnectedAccountsSettingsSection profile={PROFILE} onRefetchProfile={() => {}} />)
  const discordCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/auth/discord/disconnect'))
  return { discordCalls, confirmSpy }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.style.overflow = ''
})

describe('Discord disconnect confirmation', () => {
  it('asks in-app — never window.confirm — and sends nothing until confirmed', async () => {
    const { discordCalls, confirmSpy } = setup()
    const trigger = screen.getByTestId('settings-disconnect-discord')
    trigger.focus()
    fireEvent.click(trigger)

    const dialog = await screen.findByTestId('settings-confirm-dialog')
    expect(dialog.textContent).toMatch(/unlinks the AllFantasy bot/)
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(discordCalls()).toHaveLength(0)
    // Focus lands on the safe choice.
    expect(document.activeElement).toBe(screen.getByTestId('settings-confirm-cancel'))

    fireEvent.click(screen.getByTestId('settings-confirm-accept'))
    await waitFor(() => expect(discordCalls()).toHaveLength(1))
    expect(await screen.findByText('Discord disconnected.')).toBeTruthy()
  })

  it('Cancel, Escape and a backdrop tap all leave Discord connected and return focus', async () => {
    const { discordCalls } = setup()
    const trigger = screen.getByTestId('settings-disconnect-discord')

    for (const dismiss of [
      () => fireEvent.click(screen.getByTestId('settings-confirm-cancel')),
      () => fireEvent.keyDown(document, { key: 'Escape' }),
      () => fireEvent.mouseDown(screen.getByTestId('settings-confirm-dialog')),
    ]) {
      trigger.focus()
      fireEvent.click(trigger)
      await screen.findByTestId('settings-confirm-dialog')
      dismiss()
      await waitFor(() => expect(screen.queryByTestId('settings-confirm-dialog')).toBeNull())
      expect(document.activeElement).toBe(trigger)
    }
    expect(discordCalls()).toHaveLength(0)
  })

  it('keeps Tab inside the dialog', async () => {
    setup()
    fireEvent.click(screen.getByTestId('settings-disconnect-discord'))
    await screen.findByTestId('settings-confirm-dialog')
    const cancel = screen.getByTestId('settings-confirm-cancel')
    const accept = screen.getByTestId('settings-confirm-accept')
    accept.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(cancel)
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(accept)
  })
})
