/**
 * "Presented by King Buffalo" (2026-11-22, tournament audit item 7).
 *
 * The strip loaded /branding/kingbuffalo-presented-by.png, which is not a King Buffalo logo at all: it is the
 * ALLFANTASY wordmark on a 1024x682 black canvas, so every tournament said "Presented by ALLFANTASY" in a sliver of
 * blue while telling screen readers "KingBuffalo". It now shows the art pack's King Buffalo shield
 * (public/artwork/tournaments/black-gold/marks/kbi.svg) and the name as text, spelled as the design brief requires.
 */
import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { KingBuffaloPresentedBy } from '@/components/tournament/KingBuffaloPresentedBy'

afterEach(cleanup)

describe('KingBuffaloPresentedBy', () => {
  it.each(['strip', 'compact', 'footer'] as const)('shows the King Buffalo shield and the name in words (%s)', (variant) => {
    render(<KingBuffaloPresentedBy variant={variant} />)
    const strip = screen.getByTestId('kingbuffalo-presented-by')
    const img = strip.querySelector('img')!
    expect(img.getAttribute('src')).toBe('/artwork/tournaments/black-gold/marks/kbi.svg')
    // The name is real text beside the mark, so the mark itself is decorative.
    expect(img.getAttribute('alt')).toBe('')
    expect(strip.textContent).toMatch(/Presented by\s*King Buffalo/)
    expect(strip.textContent).not.toMatch(/KingBuffalo|ALLFANTASY/)
  })

  it('never loads the old mislabelled wordmark', () => {
    const { container } = render(<KingBuffaloPresentedBy />)
    expect(container.innerHTML).not.toMatch(/kingbuffalo-presented-by\.png/)
  })

  it('uses no class the global light-mode rule rewrites, nor a fixed colour', () => {
    const { container } = render(<KingBuffaloPresentedBy />)
    const offenders = Array.from(container.querySelectorAll('*')).map((n) => n.getAttribute('class') ?? '')
      .filter((c) => /text-white|bg-\[#|text-cyan|border-white/.test(c))
    expect(offenders).toEqual([])
  })
})
