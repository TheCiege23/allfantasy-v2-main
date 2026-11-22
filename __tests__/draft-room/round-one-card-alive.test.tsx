/**
 * Phase 6 (2026-11-19): the Round 1 pick card is animated with CSS — team-colour sweep, headshot
 * scale-in and breathe, letter-by-letter name, pick-number stamp — and holds still under reduced motion.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DraftRoundOneAnnouncementOverlay } from '@/components/app/draft-room/DraftRoundOneAnnouncementOverlay'
import { teamAccentColor } from '@/lib/draft-room/teamAccentColor'
import type { DraftPickSnapshot } from '@/lib/live-draft-engine/types'

afterEach(cleanup)

const pick = {
  id: 'p1', overall: 3, round: 1, slot: 3, rosterId: 'r3', displayName: 'Open Team 3',
  playerName: 'Bijan Robinson', position: 'RB', team: 'ATL', byeWeek: 5, playerId: 'x', pickLabel: '1.03',
  tradedPickMeta: null, createdAt: new Date().toISOString(),
} as unknown as DraftPickSnapshot

function renderCard() {
  render(
    <DraftRoundOneAnnouncementOverlay
      queue={[{ id: 'q1', pick, headshotUrl: null, teamLogoUrl: null }]}
      onDismissFront={vi.fn()}
      sportLabel="NFL"
    />,
  )
}

describe('the Round 1 card is alive', () => {
  it("sweeps the drafted player's team colour across the card", () => {
    renderCard()
    const card = screen.getByTestId('draft-round-one-card')
    expect(card.getAttribute('data-team-color')).toBe('#A71930') // Atlanta
    expect(card.className).toContain('af-r1-card')
    expect(screen.getByTestId('draft-round-one-sweep')).toBeTruthy()
  })

  it('reveals the name letter by letter, and still reads as one name to a screen reader', () => {
    renderCard()
    const name = screen.getByTestId('draft-round-one-player')
    expect(name.querySelectorAll('.af-r1-letter')).toHaveLength('Bijan Robinson'.length)
    expect(name.querySelector('.sr-only')?.textContent).toBe('Bijan Robinson')
    expect(name.querySelector('[aria-hidden]')).toBeTruthy()
  })

  it('stamps the pick number', () => {
    renderCard()
    expect(screen.getByTestId('draft-round-one-stamp').textContent).toBe('1.03')
  })

  it('stops every animation under reduced motion', () => {
    const css = readFileSync(resolve(process.cwd(), 'components/app/draft-room/round-one-card.css'), 'utf8')
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    for (const cls of ['.af-r1-card', '.af-r1-sweep', '.af-r1-headshot', '.af-r1-letter', '.af-r1-stamp']) {
      expect(reduced).toContain(cls)
    }
    expect(reduced).toMatch(/animation: none !important/)
  })
})

describe('teamAccentColor', () => {
  it('uses NFL primaries, old codes included, and a stable colour for anything else', () => {
    expect(teamAccentColor('KC')).toBe('#E31837')
    expect(teamAccentColor('JAC')).toBe(teamAccentColor('JAX'))
    expect(teamAccentColor('LAL', 'NBA')).toBe(teamAccentColor('LAL', 'NBA'))
    expect(teamAccentColor('LAL', 'NBA')).toMatch(/^#[0-9a-f]{6}$/i)
    expect(teamAccentColor(null)).toMatch(/^#/)
  })
})
