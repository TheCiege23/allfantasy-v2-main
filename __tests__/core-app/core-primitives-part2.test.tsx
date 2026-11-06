/**
 * The second pass of the redraft /core screens onto the shared page pieces (components/core-app/primitives):
 *
 *   1. StatStrip's new, optional props — value-first order, a reason line for a missing tile, a movement
 *      indicator, a screen's own class and data hooks, a decoration slot — render, and movement is never
 *      carried by colour or a glyph alone.
 *   2. The screens that hand-rolled their stat tiles now render them through StatStrip, and their old tile
 *      markup is gone from the source.
 *   3. No migrated stylesheet still boxes a tile itself — no card radius, padding or border of its own — so
 *      every tile takes `--af-radius-card` (16px) from the one primitive rule.
 *   4. Matchup's page title is PageHeader's: "Matchup", the week as its eyebrow, the banner directly under it.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({ useOptionalLanguage: () => ({ language: 'en' }) }))
vi.mock('next/link', () => ({
  default: ({ href, children, prefetch: _prefetch, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => (
    <a href={String(href)} {...props}>
      {children}
    </a>
  ),
}))
vi.mock('next/navigation', async (orig) => ({
  ...(await orig<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, prefetch() {}, back() {}, forward() {} }),
  usePathname: () => '/core/matchup',
  useSearchParams: () => new URLSearchParams('league=l1'),
}))

import { StatStrip, type StatItem } from '@/components/core-app/primitives'
import Matchup from '@/components/core-app/screens/Matchup'
import type { MatchupData } from '@/lib/core-app/matchup'

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const noComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

afterEach(cleanup)

/* ── 1. StatStrip's new props ─────────────────────────────────────────────────────────────── */

describe('StatStrip: value first, reasons, movement', () => {
  it('value-first order puts the figure before its label in the DOM, and stamps the strip', () => {
    const { container } = render(
      <StatStrip
        order="value-first"
        items={[
          { key: 'a', value: '3', label: 'already clinched', tone: 'good' },
          { key: 'b', value: '62%', label: 'title odds in Kings', sub: 'best of 4' },
        ]}
      />,
    )
    const grid = container.querySelector('.af-pg-stats')!
    expect(grid.getAttribute('data-order')).toBe('value-first')
    const tiles = [...grid.querySelectorAll('.af-pg-stat')]
    expect(tiles.map((t) => [...t.children].map((c) => c.className))).toEqual([
      ['af-pg-stat-value af-num', 'af-pg-stat-label'],
      ['af-pg-stat-value af-num', 'af-pg-stat-label', 'af-pg-stat-sub'],
    ])
    expect(tiles[0].textContent).toBe('3already clinched')
  })

  it('label-first stays the default, unstamped', () => {
    const { container } = render(<StatStrip items={[{ key: 'a', value: '1', label: 'Live now' }]} />)
    const grid = container.querySelector('.af-pg-stats')!
    expect(grid.hasAttribute('data-order')).toBe(false)
    expect([...grid.querySelector('.af-pg-stat')!.children].map((c) => c.className)).toEqual(['af-pg-stat-label', 'af-pg-stat-value af-num'])
  })

  it('a missing tile reads as a dash with its reason, never as a figure, and drops its tone', () => {
    const { container } = render(
      <StatStrip
        items={[{ key: 'faab', value: '$0', label: 'Your FAAB', tone: 'good', missing: true, reason: 'this platform does not publish remaining FAAB' }]}
      />,
    )
    const tile = container.querySelector('.af-pg-stat')!
    expect(tile.getAttribute('data-missing')).toBe('true')
    expect(tile.hasAttribute('data-tone')).toBe(false)
    expect(tile.querySelector('.af-pg-stat-value')?.textContent).toBe('—')
    expect(tile.querySelector('.af-pg-stat-why')?.textContent).toBe('this platform does not publish remaining FAAB')
    expect(tile.textContent).not.toContain('$0')
  })

  it('a reason line also carries a note on a tile that has its figure', () => {
    const { container } = render(<StatStrip items={[{ key: 'r', value: 'WR12', label: 'Pos rank', reason: 'of 143 projected' }]} />)
    expect(container.querySelector('.af-pg-stat')?.hasAttribute('data-missing')).toBe(false)
    expect(container.querySelector('.af-pg-stat-why')?.textContent).toBe('of 143 projected')
  })

  it('movement: the arrow and amount are drawn but hidden from assistive tech; the sentence is what is read', () => {
    const items: StatItem[] = [
      { key: 'up', value: '2nd', label: 'Table position', movement: { direction: 'up', amount: 2, label: 'up 2 places' } },
      { key: 'down', value: '5th', label: 'AF Power', movement: { direction: 'down', amount: 1, label: 'down 1 place' } },
      { key: 'flat', value: '7th', label: 'Rank', movement: { direction: 'flat', label: 'no change' } },
    ]
    const { container } = render(<StatStrip items={items} />)
    const moves = [...container.querySelectorAll('.af-pg-stat-move')]
    expect(moves.map((m) => m.getAttribute('data-dir'))).toEqual(['up', 'down', 'flat'])
    expect(moves.map((m) => m.querySelector('[aria-hidden="true"]')?.textContent)).toEqual(['▲2', '▼1', '–'])
    expect(moves.map((m) => m.querySelector('.af-pg-stat-sr')?.textContent)).toEqual(['up 2 places', 'down 1 place', 'no change'])
    // The arrow sits in the value's row, beside the figure, not in the label.
    expect(moves[0].parentElement?.className).toBe('af-pg-stat-valuerow')
    expect(moves[0].parentElement?.querySelector('.af-pg-stat-value')?.textContent).toBe('2nd')
    // Read in order, the tile says the figure and then which way it moved.
    expect(within(container.querySelectorAll('.af-pg-stat')[0] as HTMLElement).getByText('up 2 places')).toBeTruthy()
  })

  it('the movement sentence is visually hidden by the primitive stylesheet, and coloured by direction', () => {
    const css = read('components/core-app/primitives/af-primitives.css').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).toMatch(/\.af-core \.af-pg-stat-sr \{[^}]*position: absolute;[^}]*clip: rect\(0 0 0 0\)/)
    expect(css).toMatch(/\.af-core \.af-pg-stat-move\[data-dir='up'\] \{ color: var\(--good\); \}/)
    expect(css).toMatch(/\.af-core \.af-pg-stat-move\[data-dir='down'\] \{ color: var\(--bad\); \}/)
  })

  it('no movement on a missing tile: there is no figure for it to qualify', () => {
    const { container } = render(
      <StatStrip items={[{ key: 'm', value: '3rd', label: 'Rank', missing: true, movement: { direction: 'up', amount: 1, label: 'up 1 place' } }]} />,
    )
    expect(container.querySelector('.af-pg-stat-move')).toBeNull()
  })

  it('carries a screen class, data hooks and a decoration through, and skips an undefined hook', () => {
    const { container } = render(
      <StatStrip
        items={[
          {
            key: 'faab',
            value: '$63',
            label: 'Your FAAB',
            className: 'af-wv-tile',
            data: { tile: 'faab', kpi: undefined },
            extra: <span className="af-wv-track" aria-hidden="true" data-testid="bar" />,
          },
        ]}
      />,
    )
    const tile = container.querySelector('.af-pg-stat')!
    expect(tile.className).toBe('af-pg-stat af-wv-tile')
    expect(tile.getAttribute('data-tile')).toBe('faab')
    expect(tile.hasAttribute('data-kpi')).toBe(false)
    expect(tile.lastElementChild).toBe(screen.getByTestId('bar'))
  })
})

/* ── 2. The migrated screens render their tiles through StatStrip ─────────────────────────── */

/** Each migrated screen, and the hand-rolled tile classes it used to draw. */
const MIGRATED_TILES: Array<{ screen: string; file: string; gone: RegExp[]; order: 'value-first' | 'label-first' }> = [
  { screen: 'Standings', file: 'components/core-app/screens/Standings.tsx', gone: [/af-st-tile-(v|s|row)\b/, /<Move\b/], order: 'label-first' },
  { screen: 'Season Outlook', file: 'components/core-app/screens/SeasonOutlook.tsx', gone: [/af-so-tile\b/, /af-so-tile-[vl]\b/], order: 'value-first' },
  { screen: 'League career', file: 'components/core-app/screens/LeagueCareer.tsx', gone: [/af-lc-stat(-[vs])?\b/], order: 'value-first' },
  { screen: 'Waivers', file: 'components/core-app/screens/Waivers.tsx', gone: [/af-wv-tile-(value|sub|why)\b/, /<Tile\b/], order: 'value-first' },
  { screen: 'Player Finder', file: 'components/core-app/screens/PlayerFinder.tsx', gone: [/af-pf-tile-(value|label|why)\b/, /<StatTile\b/], order: 'value-first' },
]

describe('migrated screens draw their stat tiles through StatStrip', () => {
  it.each(MIGRATED_TILES)('$screen renders StatStrip and none of its old tile markup', ({ file, gone, order }) => {
    const src = noComments(read(file))
    expect(src).toMatch(/<StatStrip\b/)
    expect(src).toMatch(/from '@\/components\/core-app\/primitives(\/StatStrip)?'/)
    if (order === 'value-first') expect(src).toMatch(/<StatStrip[^>]*order="value-first"/)
    else expect(src).not.toMatch(/order="value-first"/)
    for (const re of gone) expect(src).not.toMatch(re)
  })
})

/* ── 3. No migrated stylesheet boxes a tile itself ───────────────────────────────────────── */

const MIGRATED_CSS = [
  'components/core-app/af-standings.css',
  'components/core-app/af-core-redraft-standings.css',
  'components/core-app/af-season-outlook.css',
  'components/core-app/af-league-career.css',
  'components/core-app/af-waivers.css',
  'components/core-app/af-player-finder.css',
  'components/core-app/af-core-redraft-waivers-finder.css',
]

/** The tile classes the screens carry onto StatStrip tiles (or onto the strip itself). */
const TILE_CLASSES = ['af-st-tiles', 'af-st-tile', 'af-so-tiles', 'af-so-tile', 'af-lc-banner', 'af-lc-stat', 'af-wv-tiles', 'af-wv-tile', 'af-pf-tiles', 'af-pf-tile']

function rules(css: string): Array<{ selector: string; body: string }> {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  return [...clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2] }))
}

/** A rule that names a tile class as its SUBJECT (the last compound) and redraws the card box: radius, padding or a grid. */
const BOXES = /(^|;)\s*(border-radius|padding|display\s*:\s*grid|grid-template-columns)\s*:?/
function tileBoxers(css: string): string[] {
  return rules(css)
    .filter(({ selector, body }) => {
      if (!BOXES.test(body)) return false
      return selector.split(',').some((part) => {
        const subject = part.trim().split(/\s+|>/).filter(Boolean).pop() ?? ''
        return TILE_CLASSES.some((c) => new RegExp(`\\.${c}(?![\\w-])`).test(subject))
      })
    })
    .map(({ selector }) => selector)
}

describe('no migrated stylesheet re-declares a tile’s card box', () => {
  it('reads every migrated stylesheet (a scan of nothing passes everything)', () => {
    for (const f of MIGRATED_CSS) expect(read(f).length).toBeGreaterThan(200)
  })

  it.each(MIGRATED_CSS)('%s sets no radius, padding or grid on a tile', (file) => {
    expect(tileBoxers(read(file))).toEqual([])
  })

  it('positive control: the old tile rules, put back, are reported', () => {
    const old = [
      '.af-st-tile { padding: 17px 18px; border-radius: 13px; }',
      '.af-core.af-shell[data-format=redraft] .af-wv-tile{border-radius:14px}',
      '.af-so-tiles { display: grid; gap: 10px; }',
      '@media (max-width: 560px) { .af-lc-banner { padding: 16px; } }',
      '/* .af-pf-tile { border-radius: 12px; } */ .af-pf-block { padding: 4px; }',
      '.af-st-tile[data-tone=accent] .af-pg-stat-value { color: var(--accent); }',
    ].join('\n')
    expect(tileBoxers(old)).toEqual(['.af-st-tile', '.af-core.af-shell[data-format=redraft] .af-wv-tile', '.af-so-tiles', '.af-lc-banner'])
  })

  it('the card radius is the one token, on the primitive tile', () => {
    const prim = read('components/core-app/primitives/af-primitives.css').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(prim).toMatch(/\.af-core \.af-pg-stat \{[^}]*border-radius: var\(--af-radius-card, 16px\)/)
  })

  it('keeps the redraft identity on the carried classes, re-aimed at the primitive value', () => {
    expect(read('components/core-app/af-core-redraft-standings.css')).toContain(
      ".af-core.af-shell[data-format=redraft] .af-st-tile[data-tone='accent'] .af-pg-stat-value{color:var(--rd-accent-text)}",
    )
    expect(read('components/core-app/af-core-redraft-waivers-finder.css')).toContain(
      ".af-core.af-shell[data-format=redraft] .af-wv-tile[data-tile='faab']:not([data-missing='true']) .af-pg-stat-value{color:var(--rd-accent-text)}",
    )
  })
})

/* ── 4. Matchup's title ───────────────────────────────────────────────────────────────────── */

describe('Matchup: the shared page header, the week as its eyebrow', () => {
  beforeEach(() => {
    ;(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
      observe() {}
      disconnect() {}
    }
  })
  afterEach(() => {
    delete (globalThis as unknown as { IntersectionObserver?: unknown }).IntersectionObserver
  })

  const base = {
    league: { id: 'l1', name: 'Kings of Buffalo', platform: 'native', logoUrl: null, sourceLink: null, lineupLink: null },
    weekNav: { prev: 8, next: 10 },
    extraMatchup: null,
    teams: { available: false, reason: 'no matchup resolved, so there are no teams to name' },
    sides: { available: false, reason: 'no matchup resolved' },
    lineups: { available: false, reason: 'no matchup resolved, so there are no lineups to pair' },
    identityNote: null,
    playerScoring: { available: false, reason: 'n/a' },
    winProbability: { available: false, reason: 'n/a' },
    projectedFinal: { available: false, reason: 'n/a' },
    yetToPlay: { available: false, reason: 'n/a' },
    starterCountsBySide: null,
  }

  it('titles the page "Matchup" with "Week 9" above it, then the unchanged week banner', () => {
    const data = { ...base, week: { available: true, data: { week: 9, season: 2026, isFinal: true } } } as unknown as MatchupData
    const { container } = render(<Matchup data={data} />)
    const h1s = [...container.querySelectorAll('h1')]
    expect(h1s).toHaveLength(1)
    expect(h1s[0].textContent).toBe('Matchup')
    expect(h1s[0].className).toBe('af-pg-title')
    const head = h1s[0].closest('header.af-pg-head')!
    expect(head.classList.contains('af-mu-head')).toBe(true)
    expect(screen.getByTestId('matchup-week-eyebrow').textContent).toBe('Week 9')
    // The banner follows the header directly, still naming the league (as text) and the week.
    const banner = head.nextElementSibling as HTMLElement
    expect(banner.className).toBe('af-mu-week')
    expect(banner.querySelector('p.af-mu-league-name')?.textContent).toBe('Kings of Buffalo')
    expect(banner.querySelector('.af-mu-week-label')?.textContent).toBe('Week 9 · 2026')
    expect(banner.querySelector('.af-mu-week-state')?.textContent).toBe('Final')
  })

  it('has no eyebrow when no week is on file, rather than an empty line', () => {
    const data = { ...base, week: { available: false, reason: 'no weekly results stored for this league' } } as unknown as MatchupData
    const { container } = render(<Matchup data={data} />)
    expect(container.querySelector('h1')?.textContent).toBe('Matchup')
    expect(container.querySelector('.af-pg-eyebrow')).toBeNull()
  })

  it('no Matchup stylesheet sizes a heading of its own any more', () => {
    for (const f of ['components/core-app/af-matchup.css', 'components/core-app/af-core-redraft-matchup.css']) {
      const sizers = rules(read(f)).filter(({ selector, body }) => /(^|[\s>,])h1\b|af-mu-head\b/.test(selector) && /font(-size)?\s*:/.test(body))
      expect(sizers.map((r) => `${f}: ${r.selector}`)).toEqual([])
    }
  })
})
