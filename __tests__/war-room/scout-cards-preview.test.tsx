/**
 * War Room on a phone (2026-11-10). Live at 375px War Room was 7,094px: twelve manager cards at ~385px
 * each. The cards now show the first SCOUT_CARDS_PREVIEW (this week's opponent first, then the table)
 * with "Show all N managers", and on a phone each card's four facts sit in one row. Previewed live:
 * 7,094 -> 3,720px.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: 'en' }) }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown } & Record<string, unknown>) => (
    <a href={href} {...(rest as Record<string, string>)}>{children as never}</a>
  ),
}))

import { SCOUT_CARDS_PREVIEW, Scout } from '@/components/core-app/screens/Scout'

afterEach(cleanup)

const standing = (seed: number) => ({ seed, record: { wins: 3, losses: 3, ties: 0 }, pointsFor: 300, pointsAgainst: 0, form: [], zone: 'playoff', gamesBack: 1, powerRank: seed })
const mgr = (i: number) => ({
  managerId: String(i),
  teamName: `Team ${i}`,
  ownerName: null,
  avatarUrl: null,
  isYou: i === 2,
  isNextOpponent: i === 1,
  eliminated: null,
  picks: null,
  standing: standing(i),
})
const data = (n: number) => ({
  league: { id: 'lg', name: 'The League', sport: 'NFL' },
  you: null,
  week: { seasonYear: 2026, week: 4 },
  opponent: null,
  managers: { available: true, data: Array.from({ length: n }, (_, i) => mgr(i + 1)) },
  basis: { available: false, reason: 'x' },
  format: { kind: 'redraft', elimination: false, bestBall: false, dynasty: false, picks: null },
})
const props = { gamePlanHref: '/p', matchupHref: '/m', standingsHref: '/s', tradesHref: '/t' }
const cards = () => document.querySelectorAll('#af-sc-list > *').length

describe('War Room manager cards', () => {
  it('show the first few, then every manager behind one button, and back', () => {
    render(<Scout data={data(12) as never} {...props} />)
    expect(cards()).toBe(SCOUT_CARDS_PREVIEW)
    // Scoped to the cards: "The room at a glance" above them lists every team by design.
    const list = document.querySelector('#af-sc-list')!
    expect(list.textContent).toContain('Team 1')
    expect(list.textContent).not.toContain('Team 12')
    const more = screen.getByRole('button', { name: 'Show all 12 managers' })
    expect(more.getAttribute('aria-expanded')).toBe('false')
    expect(more.getAttribute('aria-controls')).toBe('af-sc-list')
    fireEvent.click(more)
    expect(cards()).toBe(12)
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer managers' }))
    expect(cards()).toBe(SCOUT_CARDS_PREVIEW)
  })

  it('adds no button when every card already shows', () => {
    render(<Scout data={data(SCOUT_CARDS_PREVIEW) as never} {...props} />)
    expect(cards()).toBe(SCOUT_CARDS_PREVIEW)
    expect(document.querySelector('.af-sc-more')).toBeNull()
  })

  it('puts the four facts in one row on a phone, each column as wide as its content', () => {
    const css = readFileSync(resolve(process.cwd(), 'components/core-app/af-scout.css'), 'utf8')
      .replace(/\r\n/g, '\n')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    const start = css.indexOf('@media (max-width: 560px) {')
    const before = css.slice(0, start)
    expect((before.match(/\{/g) ?? []).length).toBe((before.match(/\}/g) ?? []).length)
    expect(css.slice(start)).toMatch(/\.af-core \.af-sc-facts \{\s*grid-template-columns: repeat\(4, auto\);\s*justify-content: space-between;/)
  })
})
