/**
 * Big Brother standings fit their card (2026-11-07, Big Brother audit item 5). Measured in /e2e/big-brother-league:
 *   - the table had an 880px floor inside a card narrower than that at every width: 6 columns off-screen at 390px,
 *     5 at 820, 2 even at 1440 — and "Nominations" broke mid-word ("Nominatio / ns")
 *   - on a phone the first team sat 1010px into the section, below an explainer, a scroll hint, a 2×2 tile grid and
 *     three stacked filters
 * Now: short visible headers (full names for screen readers) and no floor; on a narrow card, compact per-houseguest
 * cards instead of the table, the counts in one row, the explainer in a disclosure. First team at 653px.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { BigBrotherStandings } from '@/components/big-brother/BigBrotherStandings'
import { buildBigBrotherStandings } from '@/lib/big-brother/standings'

vi.mock('next/link', () => ({ default: ({ children, ...props }: any) => <a {...props}>{children}</a> }))

const data = () => buildBigBrotherStandings({
  leagueId: 'l', season: 2026, rosters: ['a', 'b', 'c', 'd'].map(id => ({ id, teamName: `Team ${id}` })),
  cycles: [{ week: 1, phase: 'EVICTION_RESOLVED', hohRosterId: 'a', vetoWinnerRosterId: 'c', nominee1RosterId: 'b', nominee2RosterId: 'd',
    vetoUsed: false, vetoSavedRosterId: null, replacementNomineeRosterId: null, evictedRosterId: 'b', closedAt: '2026-09-10' }],
  juryRosterIds: ['b'], finaleSize: 2, winnerRosterId: null, viewerRosterId: 'c', scores: [{ rosterId: 'a', week: 1, totalPoints: 0 }],
})
beforeEach(() => { vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => data() })) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '')
const CSS = strip(readFileSync('components/big-brother/big-brother-standings.css', 'utf8'))
function block(prelude: RegExp): string | null {
  const at = CSS.search(prelude); if (at < 0) return null
  const open = CSS.indexOf('{', at); let depth = 0
  for (let k = open; k < CSS.length; k++) { if (CSS[k] === '{') depth++; else if (CSS[k] === '}' && --depth === 0) return CSS.slice(open + 1, k) }
  return null
}

describe('standings table headers', () => {
  it('show short labels and keep the full names for screen readers', async () => {
    render(<BigBrotherStandings leagueId="l" />)
    const region = await screen.findByRole('region', { name: 'Big Brother season standings' })
    for (const full of ['HOH wins', 'Veto wins', 'Nominations', 'Evicted week', 'Processed points']) {
      expect(within(region).getByRole('columnheader', { name: full })).toBeTruthy()
    }
    const visible = [...region.querySelectorAll('thead th')].map(th => (th.querySelector('[aria-hidden="true"]') ?? th).textContent)
    expect(visible).toEqual(['Finish', 'Team', 'House status', 'HOH', 'Veto', 'Noms', 'Evicted', 'Points'])
  })

  it('the table has no fixed 880px floor and its headers never wrap', () => {
    expect(CSS).not.toMatch(/min-width:\s*880px/)
    expect(CSS).toMatch(/\.af-bb-table thead th\s*\{[^}]*white-space:\s*nowrap/)
  })
})

describe('narrow card', () => {
  it('renders one compact card per houseguest, outside the table region', async () => {
    render(<BigBrotherStandings leagueId="l" />)
    const list = await screen.findByRole('list', { name: 'Big Brother season standings, compact' })
    const cards = within(list).getAllByRole('listitem')
    expect(cards).toHaveLength(4)
    const viewer = cards.find(c => c.hasAttribute('data-viewer'))
    expect(viewer?.textContent).toContain('Team c')
    expect(viewer?.textContent).toContain('You')
    expect(list.closest('[role="region"]')).toBeNull()
  })

  it('the card switches by its own width: cards on, table off, counts in one row', () => {
    expect(CSS).toMatch(/container:\s*af-bb-standings\s*\/\s*inline-size/)
    const band = block(/@container\s+af-bb-standings\s*\(\s*max-width:\s*\d+px\s*\)\s*\{/)
    expect(band, 'no @container af-bb-standings band').not.toBeNull()
    expect(band).toMatch(/\.af-standings-scroll\s*\{\s*display:\s*none/)
    expect(band).toMatch(/\.af-bb-cards\s*\{\s*display:\s*grid/)
    expect(band).toMatch(/\.af-bb-metrics\s*\{[^}]*repeat\(4/)
    expect(CSS).toMatch(/^\.af-bb-cards\s*\{\s*display:\s*none/m)
  })

  it('folds the explainer into one disclosure and drops the "scroll horizontally" hint', async () => {
    render(<BigBrotherStandings leagueId="l" />)
    await screen.findByRole('heading', { name: 'House standings' })
    expect(screen.getByText('How standings work').closest('details')).toBeTruthy()
    expect(screen.queryByText(/Scroll horizontally/)).toBeNull()
  })
})
