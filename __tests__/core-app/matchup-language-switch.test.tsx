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
/* Background refreshes go through the deploy guard (lib/core-app/deployGuard). A synchronous
   pass-through keeps fake-timer assertions in the same tick; guard.ok=false is "a deploy landed". */
const guard = vi.hoisted(() => ({ ok: true }))
vi.mock('@/lib/core-app/deployGuard', () => ({
  primeDeployBaseline: () => Promise.resolve(),
  canRefreshInBackground: () => ({ then: (cb: (ok: boolean) => void) => cb(guard.ok) }),
  refreshInBackground: (fn: () => void) => { if (guard.ok) fn(); return Promise.resolve() },
}))
vi.mock('@/components/core-app/routeRefreshClaim', () => ({ claimRouteRefresh: () => () => {} }))

import { MatchupPulseRefresh } from '@/components/core-app/MatchupPulseRefresh'
import { MatchupPickerBlurb } from '@/components/core-app/MatchupPickerCopy'

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

  /* The failure notice and the all-leagues back link went with the no-league board (2026-11-12). */
  it('the picker blurb, en → es → en', () => {
    const { rerender } = render(<MatchupPickerBlurb />)
    expect(screen.getByText('Pick a league for its full box score.')).toBeTruthy()

    h.language = 'es'
    rerender(<MatchupPickerBlurb />)
    expect(screen.getByText('Elige una liga para ver su marcador completo.')).toBeTruthy()

    h.language = 'en'
    rerender(<MatchupPickerBlurb />)
    expect(screen.getByText('Pick a league for its full box score.')).toBeTruthy()
  })
})
