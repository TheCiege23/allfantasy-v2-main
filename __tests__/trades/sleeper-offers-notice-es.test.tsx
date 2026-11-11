// @vitest-environment jsdom
/** The notice in Spanish (2026-11-11), added with the Spanish cross-league trades board that shows it first. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: 'es' }) }))

import { SleeperOffersNotice } from '@/components/trades/SleeperOffersNotice'

afterEach(() => cleanup())

describe('SleeperOffersNotice — Spanish', () => {
  it('says why the offer is missing and both ways in, in Spanish', () => {
    render(<SleeperOffersNotice leagueId="L1" />)
    const text = screen.getByTestId('sleeper-offers-notice').textContent ?? ''
    expect(text).toContain('Sleeper solo comparte un intercambio cuando se acepta')
    expect(text).toContain('Sube una captura')
    expect(text).toContain('Califica una oferta de Sleeper')
    expect(text).not.toMatch(/only shares a trade/)
    expect(screen.getByRole('button', { name: 'Entendido' })).toBeTruthy()
  })
})
