import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import { DashboardHeaderControls } from '@/app/dashboard/components/DashboardHeaderControls'

const push = vi.fn()
const signOutMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

vi.mock('next-auth/react', () => ({
  signOut: (...args: unknown[]) => signOutMock(...args),
}))

vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useLanguage: () => ({ t: (key: string) => key, tInterpolate: (key: string) => key }),
}))

vi.mock('@/hooks/useEntitlements', () => ({
  useEntitlements: () => ({
    loading: false,
    error: null,
    hasCommissioner: false,
    hasPro: false,
    hasWarRoom: false,
    hasSupreme: false,
  }),
}))

const tokenBalanceMock = vi.fn(() => ({ balance: 0, loading: false, isAdminBypassAccount: false }))
vi.mock('@/hooks/useTokenBalance', () => ({
  useTokenBalance: () => tokenBalanceMock(),
}))

describe('DashboardHeaderControls (Phase 3.8D rail rehome)', () => {
  it('rehomes Create/Import and the profile/account menu into the header', () => {
    const onImport = vi.fn()
    render(<DashboardHeaderControls userName="Local Dev User" onImport={onImport} />)

    // Create League + Import survive the rail removal.
    expect(screen.getByTestId('dashboard-header-create-league')).toBeTruthy()
    const importBtn = screen.getByTestId('dashboard-header-import-league')
    fireEvent.click(importBtn)
    expect(onImport).toHaveBeenCalledTimes(1)

    // Profile menu is collapsed until opened, then reveals Profile / Settings / Sign Out.
    expect(screen.queryByTestId('dashboard-header-user-menu')).toBeNull()
    fireEvent.click(screen.getByTestId('dashboard-header-profile'))
    expect(screen.getByTestId('dashboard-header-user-menu')).toBeTruthy()
    expect(screen.getByTestId('dashboard-header-user-menu-profile')).toBeTruthy()
    expect(screen.getByTestId('dashboard-header-user-menu-settings')).toBeTruthy()

    // Sign out routes through next-auth.
    fireEvent.click(screen.getByTestId('dashboard-header-user-menu-signout'))
    expect(signOutMock).toHaveBeenCalledTimes(1)
  })
})

describe('DashboardHeaderControls — token balance badge (visual bug-fix pass 1d)', () => {
  it('comma-formats a real balance for a normal account', () => {
    tokenBalanceMock.mockReturnValue({ balance: 2500, loading: false, isAdminBypassAccount: false })
    render(<DashboardHeaderControls userName="Real User" onImport={vi.fn()} />)
    expect(screen.getByText('· 2,500')).toBeTruthy()
  })

  it('never shows the raw dev-admin balance (e.g. 1,000,000,000) — shows a distinct Admin marker instead', () => {
    tokenBalanceMock.mockReturnValue({ balance: 1_000_000_000, loading: false, isAdminBypassAccount: true })
    render(<DashboardHeaderControls userName="Owner Dev Account" onImport={vi.fn()} />)

    expect(screen.queryByText(/1,000,000,000/)).toBeNull()
    const marker = screen.getByText('· Admin')
    expect(marker.getAttribute('title')).toMatch(/synthetic balance/i)
  })
})
