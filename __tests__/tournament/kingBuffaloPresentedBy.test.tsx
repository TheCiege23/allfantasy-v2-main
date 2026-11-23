/**
 * "Presented by King Buffalo" (2026-11-22, tournament audit item 7).
 *
 * The strip loaded /branding/kingbuffalo-presented-by.png, which is not a King Buffalo logo at all: it is the
 * ALLFANTASY wordmark on a 1024x682 black canvas, so every tournament said "Presented by ALLFANTASY" in a sliver of
 * blue while telling screen readers "KingBuffalo". It now shows the art pack's King Buffalo shield
 * (public/artwork/tournaments/black-gold/marks/kbi.svg) and the name as text, spelled as the design brief requires.
 *
 * 2026-11-23: King Buffalo presents its own invitational, not every tournament (owner's ruling). The strip rendered on
 * every tournament and, through SpecialtyLeagueHomeHero, on Survivor and Big Brother league heroes too.
 */
import React from 'react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { KingBuffaloPresentedBy, isKingBuffaloTournament } from '@/components/tournament/KingBuffaloPresentedBy'
import { SpecialtyLeagueHomeHero } from '@/components/league-home/SpecialtyLeagueHomeHero'

afterEach(cleanup)

const KBI = 'King Buffalo Invitational'

describe('KingBuffaloPresentedBy', () => {
  it.each(['strip', 'compact', 'footer'] as const)('shows the King Buffalo shield and the name in words (%s)', (variant) => {
    render(<KingBuffaloPresentedBy tournamentName={KBI} variant={variant} />)
    const strip = screen.getByTestId('kingbuffalo-presented-by')
    const img = strip.querySelector('img')!
    expect(img.getAttribute('src')).toBe('/artwork/tournaments/black-gold/marks/kbi.svg')
    // The name is real text beside the mark, so the mark itself is decorative.
    expect(img.getAttribute('alt')).toBe('')
    expect(strip.textContent).toMatch(/Presented by\s*King Buffalo/)
    expect(strip.textContent).not.toMatch(/KingBuffalo|ALLFANTASY/)
  })

  it('never loads the old mislabelled wordmark', () => {
    const { container } = render(<KingBuffaloPresentedBy tournamentName={KBI} />)
    expect(container.innerHTML).not.toMatch(/kingbuffalo-presented-by\.png/)
  })

  it('uses no class the global light-mode rule rewrites, nor a fixed colour', () => {
    const { container } = render(<KingBuffaloPresentedBy tournamentName={KBI} />)
    const offenders = Array.from(container.querySelectorAll('*')).map((n) => n.getAttribute('class') ?? '')
      .filter((c) => /text-white|bg-\[#|text-cyan|border-white/.test(c))
    expect(offenders).toEqual([])
  })

  it.each(['Summer Slam Cup', 'Gridiron Invitational', '', null, undefined])('shows nothing on another tournament (%s)', (name) => {
    const { container } = render(<KingBuffaloPresentedBy tournamentName={name} />)
    expect(container.innerHTML).toBe('')
  })
})

describe('isKingBuffaloTournament', () => {
  it.each([KBI, 'king buffalo invitational 2026', 'KingBuffalo Cup', 'KBI', 'KBI 2026'])('recognises %s', (name) => {
    expect(isKingBuffaloTournament(name)).toBe(true)
  })

  it.each(['Buffalo Bills Fans Cup', 'KBIX League', 'Kings Classic'])('does not claim %s', (name) => {
    expect(isKingBuffaloTournament(name)).toBe(false)
  })
})

describe('SpecialtyLeagueHomeHero', () => {
  beforeAll(() => {
    window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never
    globalThis.fetch = (async () => new Response('{}', { status: 404 })) as typeof fetch
  })
  const base = { leagueId: 'L1', leagueName: 'Island League', sport: 'NFL', season: 2026, tournamentContext: null } as const

  it.each(['survivor', 'big_brother'] as const)('a %s hero says nothing about King Buffalo', (variant) => {
    render(<SpecialtyLeagueHomeHero {...(base as never)} variant={variant} />)
    expect(screen.queryByTestId('kingbuffalo-presented-by')).toBeNull()
  })
})
