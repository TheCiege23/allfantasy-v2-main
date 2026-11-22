/**
 * Phone pass 2 (2026-11-07): the "also in" chips fold behind one summary line on Home, and the My team
 * header gives Record only its own width. Live at 375px: the injury section 2,028 -> 1,397px, the My
 * team header 365 -> 313px.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fireEvent, render } from '@testing-library/react'

import { Dash3ATriage, type TriageBookRow } from '@/components/core-app/screens/Dash3ATriage'

const NOW = new Date('2026-09-06T16:00:00Z')
const BASIS = { format: 'DYNASTY', qbFormat: 'ONE_QB' }

function row(): TriageBookRow {
  return {
    initials: 'AJ',
    name: 'Ashton Jeanty',
    imageUrl: null,
    leagues: [
      { id: 'l1', name: 'Bla bla bla', platform: 'sleeper', imageUrl: null, slot: 'starter', bench: [] },
      { id: 'l2', name: 'Guilly League 26', platform: 'sleeper', imageUrl: null, slot: 'bench' },
      { id: 'l3', name: 'Work League', platform: 'espn', imageUrl: null, slot: 'bench' },
      { id: 'l4', name: 'Office League', platform: 'espn', imageUrl: null, slot: 'ir' },
    ],
    note: 'RB · Out',
    position: 'RB',
    team: 'LV',
    sport: 'NFL',
    status: 'Out',
    exposure: '4 of 61',
    exposureCount: 4,
    exposureTotal: 61,
    startingIn: 1,
    benchIn: 2,
    irIn: 1,
    taxiIn: 0,
    description: 'Ruled out.',
    value: { value: 6400, overallRank: 14, positionRank: 4 },
    reportedAt: NOW.toISOString(),
    reportedAgo: '3h ago',
    nextKickoffAt: null,
    tone: 'bad',
  } as TriageBookRow
}

const css = (p: string) =>
  readFileSync(resolve(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '')

const topLevel = (code: string, start: number) => {
  const before = code.slice(0, start)
  return (before.match(/\{/g) ?? []).length - (before.match(/\}/g) ?? []).length
}

describe('the "also in" chips on a phone', () => {
  it('sums them in one toggle that names the count and the handled leagues, and opens the list', () => {
    const { container } = render(<Dash3ATriage book={[row()]} now={NOW} valueBasis={BASIS} />)
    const toggle = container.querySelector<HTMLButtonElement>('.af-triage-chips-toggle')!
    expect(toggle.textContent).toBe('Also in 3 more leagues · benched in 2')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    const list = container.querySelector('.af-triage-leagues')!
    expect(toggle.getAttribute('aria-controls')).toBe(list.id)
    expect(list.hasAttribute('data-open')).toBe(false)
    // The chips stay in the DOM (a wide screen shows them); only the phone stylesheet hides them.
    expect(list.querySelectorAll('.af-triage-league').length).toBe(3)
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(toggle.textContent).toBe('Hide the other leagues')
    expect(list.getAttribute('data-open')).toBe('true')
  })

  it('hides the chips only inside a top-level phone query, and the toggle everywhere else', () => {
    const code = css('components/core-app/af-dash-triage.css')
    const start = code.lastIndexOf('@media (max-width: 640px) {')
    expect(topLevel(code, start)).toBe(0)
    expect(code.slice(0, start)).toMatch(/\.af-core \.af-triage-chips-toggle \{\s*display: none;\s*\}\s*$/)
    const block = code.slice(start)
    expect(block).toMatch(/\.af-triage-leagues:not\(\[data-open\]\) \{\s*display: none;/)
    expect(block).toMatch(/\.af-core \.af-triage-chips-toggle \{\s*display: flex;[^}]*min-height: 44px;/)
  })
})

describe('the My team header on a narrow page', () => {
  it('gives Record its own width and keeps two lines of the roster-value reason', () => {
    const code = css('components/core-app/af-my-team.css')
    const start = code.lastIndexOf('@container af-mt (max-width: 500px) {')
    expect(topLevel(code, start)).toBe(0)
    const block = code.slice(start)
    expect(block).toContain('.af-core .af-mt-head .af-mt-tiles { grid-template-columns: auto minmax(0, 1fr); }')
    expect(block).toMatch(/\.af-mt-tile--grade \.af-mt-tile-why \{[^}]*-webkit-line-clamp: 2;/)
  })
})
