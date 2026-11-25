import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

vi.mock('@/components/chimmy-surfaces/ChimmyAlertPreferencesPanel', () => ({
  default: () => <div data-testid="chimmy-alert-preferences-panel">chimmy panel</div>,
}))

import AlertSettingsClient from '@/app/alerts/settings/AlertSettingsClient'

describe('AlertSettingsClient', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({
      json: async () => ({
        injuryAlerts: true,
        performanceAlerts: true,
        lineupAlerts: true,
      }),
    })
  })

  it('renders Chimmy preferences section after loading', async () => {
    render(<AlertSettingsClient />)

    await waitFor(() => {
      expect(screen.getByText('Chimmy alert controls')).toBeInTheDocument()
    })

    expect(screen.getByTestId('chimmy-alert-preferences-panel')).toBeInTheDocument()
    // One closed row since 2026-11-25 (the simplify pass): the panel is inside it, with no second
    // description line, and the "notification bell" fine print joined the page intro.
    const fold = screen.getByTestId('alerts-chimmy-fold')
    expect(fold.tagName).toBe('DETAILS')
    expect(fold.hasAttribute('open')).toBe(false)
    expect(fold.contains(screen.getByTestId('chimmy-alert-preferences-panel'))).toBe(true)
    expect(screen.queryByText(/Fine-tune Chimmy frequency/i)).toBeNull()
    expect(screen.queryByText(/Alerts appear in the notification bell/i)).toBeNull()
  })

  it('gives each alert switch a 48px row', async () => {
    render(<AlertSettingsClient />)
    const row = await screen.findByTestId('sports-alert-toggle-injury')
    expect(row.className).toMatch(/(^|\s)min-h-\[48px\](\s|$)/)
  })
})
