/**
 * Player Finder on a phone (2026-11-09). Live at 375px the page was 10,981px: Game day and Your shares
 * were twenty rows each. Both now show their first FINDER_LIST_PREVIEW rows with "Show all N", keeping
 * the ranks; previewed on the live page: 10,981 -> 5,598px.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { FINDER_LIST_PREVIEW } from '@/components/core-app/player-finder/GameDayTriage'
import { PlayerSharesBoard } from '@/components/core-app/player-finder/PlayerSharesBoard'
import type { PlayerShares } from '@/lib/core-app/playerShares'

afterEach(cleanup)

const row = (i: number) => ({
  player: { sport: 'NFL', externalId: `x-${i}`, sleeperId: String(i), name: `Player ${i}`, position: 'WR', team: 'NYG', imageUrl: null },
  leagues: 20 - i,
  starts: 1,
  ir: 0,
  leagueIds: [],
  status: null,
  description: null,
})
const shares = (n: number): PlayerShares => ({
  rows: Array.from({ length: n }, (_, i) => row(i + 1)),
  leaguesRead: 49,
  playersHeld: 612,
  unsupportedLeagues: 0,
})
const items = () => document.querySelectorAll('#af-pf-shares-list > li').length

describe('Your shares shows the first few, then every row behind one button', () => {
  it('opens and closes, and the ranks stay in order', () => {
    render(<PlayerSharesBoard state={{ available: true, data: shares(12) }} />)
    expect(items()).toBe(FINDER_LIST_PREVIEW)
    const more = screen.getByRole('button', { name: 'Show all 12' })
    expect(more.getAttribute('aria-expanded')).toBe('false')
    expect(more.getAttribute('aria-controls')).toBe('af-pf-shares-list')
    fireEvent.click(more)
    expect(items()).toBe(12)
    expect(document.querySelectorAll('.af-pf-share-rank')[11]?.textContent).toBe('12')
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }))
    expect(items()).toBe(FINDER_LIST_PREVIEW)
  })

  it('adds no button when the list already fits', () => {
    render(<PlayerSharesBoard state={{ available: true, data: shares(FINDER_LIST_PREVIEW) }} />)
    expect(items()).toBe(FINDER_LIST_PREVIEW)
    expect(document.querySelector('.af-pf-list-more')).toBeNull()
  })
})

describe('Game day uses the same preview', () => {
  it('slices its rows and wires the same toggle to its own list', () => {
    const tsx = readFileSync(resolve(process.cwd(), 'components/core-app/player-finder/GameDayTriage.tsx'), 'utf8')
    expect(tsx).toContain('(showAll ? rows : rows.slice(0, FINDER_LIST_PREVIEW)).map((r) => {')
    expect(tsx).toContain('aria-controls="af-pf-triage-list"')
    expect(tsx).toContain('<ul className="af-pf-triage-list" id="af-pf-triage-list">')
  })
})
