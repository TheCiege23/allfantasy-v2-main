/** The "What runs itself" card on the Commissioner Hub. */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AutomationOverview } from '@/components/core-app/commissioner/AutomationOverview'

const json = (body: unknown, ok = true) => ({ ok, json: async () => body }) as Response
afterEach(() => vi.unstubAllGlobals())

describe('AutomationOverview', () => {
  it('lists each automation with its state and a link to its switch', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({
      supported: true,
      commissionerPlan: true,
      rows: [
        { key: 'fill_empty_starters', group: 'lineups', label: 'Fill empty starting spots before lock', state: 'on', detail: 'Every hour, from the bench', href: '#ch-fill-empty-starters', plan: 'free' },
        { key: 'tanking', group: 'fairness', label: 'Anti-tanking monitor', state: 'off', detail: null, href: '/league/L1/commissioner/integrity', plan: 'commissioner' },
      ],
    })))
    render(<AutomationOverview leagueId="L1" />)
    expect(await screen.findByText(/1 of 2 automations are on/)).toBeTruthy()
    const fill = screen.getByTestId('automation-fill_empty_starters')
    expect(fill.getAttribute('data-state')).toBe('on')
    expect(fill.querySelector('a')!.getAttribute('href')).toBe('#ch-fill-empty-starters')
    expect(screen.getByTestId('automation-tanking').querySelector('a')!.getAttribute('href')).toBe('/league/L1/commissioner/integrity')
  })

  it('shows nothing for a league AllFantasy does not run', async () => {
    const fetchMock = vi.fn(async () => json({ supported: false }))
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(<AutomationOverview leagueId="L1" />)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await vi.waitFor(() => expect(container.querySelector('[data-testid="automation-overview"]')).toBeNull())
  })
})
