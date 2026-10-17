// @vitest-environment jsdom
/**
 * Switching language changes the Matchup screens' own words, both ways (2026-10-03).
 *
 * The owner's check: English → Spanish → English, and every word follows. These render the client
 * pieces that carry the matchup screens' status and notice text, flip the language between renders,
 * and assert the visible text and the accessible label follow each switch.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const h = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))

vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useOptionalLanguage: () => ({ language: h.language, setLanguage: () => {}, t: (k: string) => k }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))
vi.mock('@/components/core-app/routeRefreshClaim', () => ({ claimRouteRefresh: () => () => {} }))

import { MatchupPulseRefresh } from '@/components/core-app/MatchupPulseRefresh'
import { MatchupPickerBlurb, MatchupPickerNotice } from '@/components/core-app/MatchupPickerCopy'

afterEach(() => {
  cleanup()
  h.language = 'en'
})

describe('Matchup screens follow the language switch', () => {
  /* After mount the clock is read, so the status is an age ("0s ago"); "live"/"not started" is the server render. */
  const status = () => document.querySelector('.af-mp-live-text')?.textContent ?? ''

  it('the refresh control: status word and button label, en → es → en', () => {
    const { rerender } = render(<MatchupPulseRefresh inPlay={false} />)
    expect(status()).toMatch(/^\d+s ago$/)
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe('Refresh where you stand')

    h.language = 'es'
    rerender(<MatchupPulseRefresh inPlay={false} />)
    expect(status()).toMatch(/^hace \d+ s$/)
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe('Actualizar tu posición')

    h.language = 'en'
    rerender(<MatchupPulseRefresh inPlay />)
    expect(status()).toMatch(/^\d+s ago$/)
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe('Refresh where you stand')
  })

  it('a caller’s own label wins in either language', () => {
    h.language = 'es'
    render(<MatchupPulseRefresh inPlay label="Actualizar este enfrentamiento" />)
    expect(status()).toMatch(/^hace \d+ s$/)
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe('Actualizar este enfrentamiento')
  })

  it('the picker blurb and failure notice, en → es → en', () => {
    const view = () => (
      <>
        <MatchupPickerBlurb />
        <MatchupPickerNotice failed />
      </>
    )
    const { rerender } = render(view())
    expect(screen.getByText('Pick a league for its full box score.')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('The all-leagues board did not load.')

    h.language = 'es'
    rerender(view())
    expect(screen.getByText('Elige una liga para ver su marcador completo.')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('El tablero de todas las ligas no se cargó.')
    expect(screen.getByRole('alert').textContent).not.toMatch(/board|leagues|try again/)

    h.language = 'en'
    rerender(view())
    expect(screen.getByText('Pick a league for its full box score.')).toBeTruthy()
  })

  it('the back link on the all-leagues view', () => {
    h.language = 'es'
    render(<MatchupPickerNotice failed={false} />)
    expect(screen.getByRole('link').textContent).toBe('Volver a tu posición')
  })
})
