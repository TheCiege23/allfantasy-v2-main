import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: 'en' }) }))
vi.mock('@/lib/analytics/client', () => ({ sendProductAnalyticsBeacon: vi.fn() }))

import { CoreWelcomeTour } from '@/components/core-app/CoreWelcomeTour'

describe('Core first win', () => {
  beforeEach(() => localStorage.removeItem('af-core-welcome-v1'))

  it('offers a primary league path and a free challenge path to a new user', async () => {
    render(<CoreWelcomeTour leagueCount={0} />)
    expect(await screen.findByText(/First win: connect a league/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Import a league' })).toHaveAttribute('href', '/import')
    expect(screen.getByRole('link', { name: 'Join a bracket pool' })).toHaveAttribute('href', '/brackets/join')
  })

  it('takes a connected manager to their decisions', async () => {
    render(<CoreWelcomeTour leagueCount={1} />)
    expect(await screen.findByRole('link', { name: 'Review my week' })).toHaveAttribute('href', '/core/week')
  })
})
