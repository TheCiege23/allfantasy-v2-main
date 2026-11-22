/**
 * The display-mode control names the SETTING, not the paint: on System it says "System" even though
 * <html data-mode> holds the mode System resolved to. The account-menu picker shows all four settings
 * with the chosen one checked, and a pick persists through the same themePreference call.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

const session = vi.hoisted(() => ({ user: { id: 'u1' } as { id: string } | null }))
vi.mock('@/components/auth/useOptionalSession', () => ({ useOptionalSession: () => ({ data: session.user ? { user: session.user } : null }) }))

import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { ModeToggle } from '@/components/theme/ModeToggle'

const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }))

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockClear()
  // System chosen; this device's OS resolved it to dark, so the document is painted dark.
  window.localStorage.setItem('af_mode', 'system')
  document.documentElement.dataset.mode = 'dark'
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) as never
})
afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

async function renderIn(node: React.ReactNode) {
  let out: ReturnType<typeof render> | undefined
  await act(async () => {
    out = render(<ThemeProvider>{node}</ThemeProvider>)
  })
  return out!
}

describe('ModeToggle', () => {
  it('the compact control reads "System" on System, not the mode it resolved to', async () => {
    await renderIn(<ModeToggle />)
    const button = screen.getByRole('button')
    expect(button.textContent).toBe('System')
    expect(button.getAttribute('data-mode-setting')).toBe('system')
    expect(document.documentElement.dataset.mode).toBe('dark')
  })

  it('the picker shows all four settings with System checked', async () => {
    await renderIn(<ModeToggle variant="picker" />)
    const radios = screen.getAllByRole('radio')
    expect(radios.map((r) => r.textContent)).toEqual(['Light', 'Dark', 'AF Legacy', 'System'])
    expect(screen.getByRole('radio', { name: 'System' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: 'Dark' }).getAttribute('aria-checked')).toBe('false')
  })

  it('a pick moves the check, repaints, and saves themePreference for a signed-in viewer', async () => {
    await renderIn(<ModeToggle variant="picker" />)
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: 'Light' }))
    })
    expect(screen.getByRole('radio', { name: 'Light' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: 'System' }).getAttribute('aria-checked')).toBe('false')
    expect(document.documentElement.dataset.mode).toBe('light')
    expect(fetchMock).toHaveBeenCalledWith('/api/user/profile', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ themePreference: 'light' }) }))
  })

  it('a signed-out pick changes the mode without calling the profile route', async () => {
    session.user = null
    try {
      await renderIn(<ModeToggle variant="picker" />)
      await act(async () => {
        fireEvent.click(screen.getByRole('radio', { name: 'AF Legacy' }))
      })
      expect(screen.getByRole('radio', { name: 'AF Legacy' }).getAttribute('aria-checked')).toBe('true')
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      session.user = { id: 'u1' }
    }
  })
})
