import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider, useThemeMode } from '@/components/theme/ThemeProvider'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'

function CurrentMode() {
  const { mode } = useThemeMode()
  return <output>{mode}</output>
}

describe('Core preferences', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.dataset.mode = 'dark'
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    })
  })

  it.each(['light', 'legacy', 'system'] as const)('restores %s before persisting the initial mode', async (saved) => {
    window.localStorage.setItem('af_mode', saved)
    render(<ThemeProvider><CurrentMode /></ThemeProvider>)
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(saved))
    expect(window.localStorage.getItem('af_mode')).toBe(saved)
    expect(document.documentElement.dataset.mode).toBe(saved === 'system'
      ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
      : saved)
  })

  it('provides Spanish labels for the shared navigation and chat', () => {
    expect(coreUiCopy('My team', 'es')).toBe('Mi equipo')
    expect(coreUiCopy('League chat', 'es')).toBe('Chat de la liga')
    expect(coreUiCopy('My team', 'en')).toBe('My team')
  })
})
