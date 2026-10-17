// @vitest-environment jsdom
/**
 * Refocusing the window on Settings › Connected Accounts refetches the profile. Before, a failed
 * refetch — or /api/user/profile's 200-with-no-user answer to a signed-out session — set the
 * profile to null and SettingsApp swapped the whole page for its full-screen error. A refetch now
 * keeps the last good profile and says why inline; a signed-out session is flagged so Settings can
 * offer "Sign in again". Refocus refreshes are throttled to one per 30s.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, renderHook, waitFor } from '@testing-library/react'

vi.mock('next-auth/react', () => ({ useSession: () => ({ update: vi.fn() }), signIn: vi.fn() }))
vi.mock('@/lib/state-consistency/state-events', () => ({ dispatchStateRefreshEvent: vi.fn() }))

import { useSettingsProfile } from '@/hooks/useSettingsProfile'

const PROFILE = { userId: 'u1', username: 'guap', displayName: 'Guap' }
type Step = { status: number; body?: unknown } | 'network'

/** Each URL answers with its queued steps in order; the last step repeats. */
function scripted(script: Record<string, Step[]>) {
  const calls: Record<string, number> = {}
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const key = Object.keys(script).find((k) => url.includes(k))!
      const i = calls[key] ?? 0
      calls[key] = i + 1
      const step = script[key]![Math.min(i, script[key]!.length - 1)]!
      if (step === 'network') throw new TypeError('Failed to fetch')
      return new Response(JSON.stringify(step.body ?? {}), { status: step.status })
    }),
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('useSettingsProfile refetch', () => {
  it('keeps the page when a refetch finds the session gone, and flags it', async () => {
    scripted({
      '/api/user/settings': [{ status: 200, body: { profile: PROFILE } }, { status: 401, body: { error: 'Unauthorized' } }],
      // What the route really answers a signed-out session: 200, no user.
      '/api/user/profile': [{ status: 200, body: { preferredLanguage: null, timezone: null, themePreference: null } }],
    })
    const { result } = renderHook(() => useSettingsProfile())
    await waitFor(() => expect(result.current.profile?.userId).toBe('u1'))

    await act(async () => {
      await result.current.fetchProfile()
    })
    expect(result.current.profile?.userId).toBe('u1') // NOT null → no full-screen error
    expect(result.current.sessionExpired).toBe(true)
    expect(result.current.error).toMatch(/session has expired/i)
  })

  it('keeps the page when a refetch fails on the network', async () => {
    scripted({
      '/api/user/settings': [{ status: 200, body: { profile: PROFILE } }, 'network'],
      '/api/user/profile': ['network'],
    })
    const { result } = renderHook(() => useSettingsProfile())
    await waitFor(() => expect(result.current.profile?.userId).toBe('u1'))

    await act(async () => {
      await result.current.fetchProfile()
    })
    expect(result.current.profile?.userId).toBe('u1')
    expect(result.current.sessionExpired).toBe(false)
    expect(result.current.error).toMatch(/couldn't refresh/i)
  })

  it('still errors on a FIRST load with nothing to keep', async () => {
    scripted({ '/api/user/settings': ['network'], '/api/user/profile': ['network'] })
    const { result } = renderHook(() => useSettingsProfile())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.profile).toBeNull()
    expect(result.current.error).toBeTruthy()
  })

  it('clears the flag once a refetch succeeds again', async () => {
    scripted({
      '/api/user/settings': [
        { status: 200, body: { profile: PROFILE } },
        { status: 401 },
        { status: 200, body: { profile: PROFILE } },
      ],
      '/api/user/profile': [{ status: 200, body: {} }],
    })
    const { result } = renderHook(() => useSettingsProfile())
    await waitFor(() => expect(result.current.profile?.userId).toBe('u1'))
    await act(async () => {
      await result.current.fetchProfile()
    })
    expect(result.current.sessionExpired).toBe(true)
    await act(async () => {
      await result.current.fetchProfile()
    })
    expect(result.current.sessionExpired).toBe(false)
    expect(result.current.error).toBeNull()
  })
})

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }))
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

describe('Connected Accounts refocus refresh', () => {
  it('refreshes at most once per 30s of window focus', async () => {
    const refetch = vi.fn()
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    render(<ConnectedAccountsSettingsSection profile={{ discordUserId: null } as never} onRefetchProfile={refetch} />)

    fireEvent.focus(window)
    fireEvent.focus(window)
    fireEvent.focus(window)
    expect(refetch).toHaveBeenCalledTimes(1)

    now += 31_000
    fireEvent.focus(window)
    expect(refetch).toHaveBeenCalledTimes(2)
  })
})
