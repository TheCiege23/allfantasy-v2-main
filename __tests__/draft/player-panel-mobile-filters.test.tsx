/**
 * Phone filter header (2026-10-29): below md only search and the position pills show; team, view
 * mode, pool, the AI ADP row and the toggle chips sit behind "Filters". At Pixel 7 size the full
 * header measured 376px against a 96px collapsed one. The wrappers are `md:contents`/`md:block`,
 * so desktop (measured unchanged at 1280px) never sees the toggle.
 */
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useLanguage: () => ({ t: (key: string) => key.split('.').pop(), language: 'en' }),
  useOptionalLanguage: () => ({ t: (key: string) => key.split('.').pop(), language: 'en' }),
}))
import { PlayerPanel, type PlayerEntry } from '@/components/app/draft-room/PlayerPanel'

const players: PlayerEntry[] = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, name: `Player ${i}`, position: 'PG', team: 'DEN', adp: i + 1 }))

beforeEach(() => vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function panel() {
  return render(
    <PlayerPanel players={players} draftedNames={new Set()} sport="NBA" canDraft={false} onAddToQueue={() => {}}
      onMakePick={() => {}} isPlayerQueued={() => false} poolLayout="card" presentationVariant="redraft_snake" />,
  )
}

describe('PlayerPanel phone filter header', () => {
  it('keeps secondary filters collapsed on phones and desktop-visible via md:contents / md:block', () => {
    panel()
    const toggle = screen.getByTestId('draft-mobile-filters-toggle')
    expect(toggle.className).toMatch(/\bmd:hidden\b/)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    const more = screen.getByTestId('draft-player-more-filters')
    const rows = screen.getByTestId('draft-player-more-filter-rows')
    expect(more.className.split(/\s+/)).toEqual(['hidden', 'md:contents'])
    expect(rows.className.split(/\s+/)).toEqual(['hidden', 'md:block'])
    // The controls it hides still exist in the DOM (desktop and e2e reach them).
    expect(more.contains(screen.getByTestId('draft-team-filter'))).toBe(true)
    expect(rows.contains(screen.getByTestId('draft-filter-hide-drafted'))).toBe(true)
    // Search and position pills are never behind the toggle.
    expect(more.contains(screen.getByTestId('draft-player-search-input'))).toBe(false)
    expect(more.contains(screen.getByTestId('draft-position-filter'))).toBe(false)
  })

  it('opens and closes, and counts hidden filters that differ from their defaults', () => {
    panel()
    const toggle = screen.getByTestId('draft-mobile-filters-toggle')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByTestId('draft-player-more-filters').className).not.toMatch(/(^|\s)hidden(\s|$)/)
    expect(screen.getByTestId('draft-player-more-filter-rows').className).toBe('block')
    expect(screen.queryByTestId('draft-mobile-filters-count')).toBeNull()
    fireEvent.click(screen.getByTestId('draft-filter-watchlist-only'))
    fireEvent.click(screen.getByTestId('draft-filter-hide-drafted')) // default is on; turning it off counts
    expect(screen.getByTestId('draft-mobile-filters-count').textContent).toBe('2')
    fireEvent.click(toggle)
    expect(screen.getByTestId('draft-player-more-filters').className.split(/\s+/)).toEqual(['hidden', 'md:contents'])
    expect(screen.getByTestId('draft-mobile-filters-count').textContent).toBe('2')
  })
})
