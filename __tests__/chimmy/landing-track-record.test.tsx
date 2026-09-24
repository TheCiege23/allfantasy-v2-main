import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/components/navigation/HomeTopNav', () => ({ default: () => null }))
vi.mock('@/components/landing/SeoLandingFooter', () => ({ default: () => null }))
vi.mock('@/components/landing/LandingCTAStrip', () => ({ LandingCTAStrip: () => null }))
vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useLanguage: () => ({ t: (k: string) => k }) }))

import ChimmyLandingClient from '@/app/chimmy/ChimmyLandingClient'

/**
 * The /chimmy page says every start/sit call is graded — and shows the platform-wide rate only once
 * enough calls are graded for it to mean something.
 */
describe('/chimmy — graded, not guessed', () => {
  it('shows the platform-wide rate and how many calls it rests on', () => {
    render(<ChimmyLandingClient trackRecord={{ right: 140, wrong: 72, same: 9, ratePct: 66 }} />)
    expect(screen.getByRole('heading', { name: 'Graded, not guessed' })).toBeTruthy()
    expect(screen.getByText('So far: 66% right')).toBeTruthy()
    expect(screen.getByText(/over 212 decided calls, plus 9 too close to call\./)).toBeTruthy()
  })

  it('makes no numeric claim before the rate is earned, or with no record', () => {
    const { rerender } = render(<ChimmyLandingClient trackRecord={{ right: 8, wrong: 3, same: 0, ratePct: null }} />)
    expect(screen.getByRole('heading', { name: 'Graded, not guessed' })).toBeTruthy()
    expect(screen.queryByText(/So far:/)).toBeNull()
    rerender(<ChimmyLandingClient />)
    expect(screen.queryByText(/So far:/)).toBeNull()
  })
})
