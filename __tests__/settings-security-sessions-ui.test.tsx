import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

/*
 * Settings › Security, 2026-10-03: the "Sign out everywhere" and "Remove phone" buttons. Both ask
 * first; a refusal shows the server's reason; sign-out-everywhere only signs this device out once
 * the revocation was actually recorded.
 */

const h = vi.hoisted(() => ({ signOut: vi.fn(async () => undefined) }))
vi.mock('@/lib/pwa/signOutAndPurge', () => ({ signOutAndPurge: h.signOut }))
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }))
vi.mock('@/components/i18n/LanguageProviderClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/i18n/LanguageProviderClient')>()
  return { ...actual, useLanguage: () => actual.defaultLanguageValue }
})

import { SecuritySettingsSection } from '@/app/settings/components/sections/SecuritySettingsSection'

const PROFILE = {
  email: 'manager@example.test',
  emailVerifiedAt: '2026-01-01T00:00:00Z',
  phone: '+15555550100',
  phoneVerifiedAt: '2026-02-01T00:00:00Z',
  hasPassword: true,
} as never

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  h.signOut.mockClear()
})

function renderSection(profile = PROFILE) {
  const onRefetch = vi.fn()
  render(<SecuritySettingsSection profile={profile} onRefetch={onRefetch} />)
  return onRefetch
}

const accept = () => fireEvent.click(screen.getByTestId('settings-confirm-accept'))

describe('Sign out everywhere', () => {
  it('asks first, then revokes and signs this device out to /login', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true })))
    vi.stubGlobal('fetch', fetchMock)
    renderSection()
    fireEvent.click(screen.getByTestId('settings-sign-out-everywhere'))
    expect(screen.getByTestId('settings-confirm-dialog').textContent).toMatch(/including this one/i)
    expect(fetchMock).not.toHaveBeenCalled()
    accept()
    await waitFor(() => expect(h.signOut).toHaveBeenCalledWith({ callbackUrl: '/login' }))
    expect(fetchMock).toHaveBeenCalledWith('/api/user/sessions/revoke-all', { method: 'POST' })
  })

  it('cancelling does nothing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderSection()
    fireEvent.click(screen.getByTestId('settings-sign-out-everywhere'))
    fireEvent.click(screen.getByTestId('settings-confirm-cancel'))
    await new Promise((r) => setTimeout(r, 0))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(h.signOut).not.toHaveBeenCalled()
  })

  it('an unrecorded revocation shows why and signs NOTHING out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ message: 'Your other devices are still signed in.' }), { status: 503 })),
    )
    renderSection()
    fireEvent.click(screen.getByTestId('settings-sign-out-everywhere'))
    accept()
    expect((await screen.findByTestId('settings-sign-out-everywhere-error')).textContent).toBe('Your other devices are still signed in.')
    expect(h.signOut).not.toHaveBeenCalled()
  })

  it('no longer points at a "Sign out below" button that does not exist', () => {
    vi.stubGlobal('fetch', vi.fn())
    renderSection()
    expect(document.body.textContent).not.toMatch(/Sign out below/)
  })
})

describe('Remove phone', () => {
  it('is offered only when a phone is on file', () => {
    vi.stubGlobal('fetch', vi.fn())
    renderSection({ ...(PROFILE as object), phone: null, phoneVerifiedAt: null } as never)
    expect(screen.queryByTestId('settings-remove-phone')).toBeNull()
  })

  it('asks first, then DELETEs and refreshes the profile', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, removed: true })))
    vi.stubGlobal('fetch', fetchMock)
    const onRefetch = renderSection()
    fireEvent.click(screen.getByTestId('settings-remove-phone'))
    expect(fetchMock).not.toHaveBeenCalled()
    accept()
    await waitFor(() => expect(onRefetch).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith('/api/user/phone', { method: 'DELETE' })
  })

  it('cancelling the dialog removes nothing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const onRefetch = renderSection()
    fireEvent.click(screen.getByTestId('settings-remove-phone'))
    fireEvent.click(screen.getByTestId('settings-confirm-cancel'))
    await new Promise((r) => setTimeout(r, 0))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(onRefetch).not.toHaveBeenCalled()
  })

  it("shows the server's reason when the phone is the only verification", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'PHONE_IS_ONLY_VERIFICATION', message: 'Verify your email first.' }), { status: 409 }),
      ),
    )
    const onRefetch = renderSection()
    fireEvent.click(screen.getByTestId('settings-remove-phone'))
    accept()
    expect((await screen.findByTestId('settings-remove-phone-error')).textContent).toBe('Verify your email first.')
    expect(onRefetch).not.toHaveBeenCalled()
  })
})
