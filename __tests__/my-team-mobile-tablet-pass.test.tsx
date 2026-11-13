/**
 * My Team mobile & tablet pass, 2026-10-03 — measured on the live pages before and after (the CSS
 * injected into production, KBFL roster and the 65-league board):
 *
 *   league view  375px  starter row 109px → 85px; starters 2,162 → 1,855px; bench 1,477 → 1,268px
 *                768px  row 94px → 72px; starters 1,849 → 1,493px; name column 174 → 190px
 *                1440px every row byte-identical
 *   (the cross-league board's half went with that board on 2026-11-12)
 *
 * A rule in the wrong query reads the same to a text search, which is why the CSS checks walk the
 * parse tree and name the query each declaration must sit in.
 */
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss, { type AtRule, type Rule } from 'postcss'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core/my-team',
  useSearchParams: () => new URLSearchParams(),
}))

import { MyTeam } from '@/components/core-app/screens/MyTeam'
import type { LineupPlayer, MyTeamData } from '@/lib/core-app/myTeam'

const read = (f: string) => readFileSync(resolve(__dirname, '../components/core-app', f), 'utf8')
const MT_CSS = read('af-my-team.css')

/** Declarations for `selector` in exactly the at-rule chain `at`, later rules winning. */
function inQuery(css: string, selector: string, at: string): Record<string, string> {
  const out: Record<string, string> = {}
  postcss.parse(css).walkRules((rule: Rule) => {
    if (!rule.selectors.includes(selector)) return
    const chain: string[] = []
    for (let p = rule.parent; p && p.type !== 'root'; p = p.parent) chain.push(`@${(p as AtRule).name} ${(p as AtRule).params}`)
    if (chain.join(' / ') !== at) return
    rule.walkDecls((d) => {
      out[d.prop] = d.value
    })
  })
  return out
}
const NARROW_PAGE = '@container af-mt (max-width: 500px)'
const FLATTEN = '.af-core .af-mt-row > .af-mt-player:not(.af-mt-empty-text):not(.af-mt-unresolved)'

describe('league view: the game line gets the row’s full width on a narrow page', () => {
  it('puts slot, portrait, name and numbers on row 1, and the game line across row 2', () => {
    expect(inQuery(MT_CSS, ".af-core .af-mt-row:not([data-empty='true'])", NARROW_PAGE)['grid-template-columns'])
      .toBe('34px 30px minmax(0, 1fr) auto')
    expect(inQuery(MT_CSS, '.af-core .af-mt-row .af-mt-player-meta', NARROW_PAGE)).toMatchObject({ 'grid-row': '2', 'grid-column': '2 / -1' })
    expect(inQuery(MT_CSS, '.af-core .af-mt-row .af-mt-player-name', NARROW_PAGE)).toMatchObject({ 'grid-row': '1', 'grid-column': '3' })
    expect(inQuery(MT_CSS, '.af-core .af-mt-row > .af-mt-projpair', NARROW_PAGE)).toMatchObject({ 'grid-row': '1', 'grid-column': '4' })
  })

  it('flattens only a real player cell — an empty or unresolved slot keeps its span', () => {
    expect(inQuery(MT_CSS, FLATTEN, NARROW_PAGE).display).toBe('contents')
    expect(inQuery(MT_CSS, `${FLATTEN} > .af-mt-player-text`, NARROW_PAGE).display).toBe('contents')
    expect(inQuery(MT_CSS, '.af-core .af-mt-row > .af-mt-player', NARROW_PAGE).display).toBeUndefined()
  })

  it('brings the separator back, since the line now fits', () => {
    expect(inQuery(MT_CSS, '.af-core .af-mt-row .af-mt-player-meta .af-mt-sep', NARROW_PAGE).display).toBe('inline')
    expect(inQuery(MT_CSS, '.af-core .af-mt-row .af-mt-player-meta .af-mt-opp', NARROW_PAGE).display).toBe('inline')
  })

  it('reads at 12px — except the position badge and the app-wide eyebrow, on purpose', () => {
    for (const c of ['af-mt-status', 'af-mt-temp', 'af-mt-taxi-years', 'af-mt-section-note', 'af-mt-mu-sub', 'af-mt-bench-check-text']) {
      expect(inQuery(MT_CSS, `.af-core .${c}`, NARROW_PAGE)['font-size']).toBe('12px')
    }
    expect(inQuery(MT_CSS, '.af-core .af-mt-slot', NARROW_PAGE)['font-size']).toBeUndefined()
    expect(inQuery(MT_CSS, '.af-core .af-label', NARROW_PAGE)['font-size']).toBeUndefined()
  })
})

const player = (over: Partial<LineupPlayer> = {}): LineupPlayer => ({
  sleeperId: 'p1', name: 'Bo Nix', position: 'QB', team: 'DEN', sport: 'NFL', imageUrl: null,
  gameContext: 'DEN vs MIA · Sun 10/4 1:00p ET', kickoff: new Date('2099-10-04T17:00:00Z'),
  preseason: false, venue: null, injuryStatus: null, ruledOut: false, projectedPoints: 19.8,
  afProjectedPoints: 22.4, afEngineProjectedPoints: 21.1, indoors: false, weather: null,
  market: null, onBye: false, ...over,
})
const page = () => ({
  league: { id: 'l1', name: 'KBFL', platform: 'sleeper', format: 'dynasty' },
  team: { available: false, reason: 'n/a' },
  starters: { available: true, data: [{ slotLabel: 'QB', player: player(), empty: false, unresolvedId: null }] },
  bench: { available: true, data: [player({ sleeperId: 'b1' })] },
  ir: { available: false, reason: 'none' },
  taxi: { available: false, reason: 'none' },
  lock: { available: false, reason: 'n/a' },
  projections: { available: true, data: { total: 19.8, projected: 1, unprojected: 0, season: '2026', week: 4, afTotal: 22.4, afEngineTotal: 21.1, afProjected: 1, standardComparable: true } },
  projectionBasis: { notes: [], scoringKnown: true },
  nextMatchup: { available: false, reason: 'no schedule on file' },
  upcomingByes: [],
  rosterGrade: { available: false, reason: 'n/a' },
  liveScore: { available: false, reason: 'n/a' },
}) as unknown as MyTeamData

describe('the abbreviation key — a touch screen never shows a title', () => {
  it('is collapsed, under the Starters heading, once', () => {
    const { container } = render(<MyTeam data={page()} />)
    const keys = container.querySelectorAll('details.af-mt-key')
    expect(keys).toHaveLength(1)
    expect(keys[0].hasAttribute('open')).toBe(false)
    expect(keys[0].closest('section')?.querySelector('h2')?.textContent).toBe('Starters')
  })

  it('spells out every mark the roster draws, in visible text', () => {
    const { container } = render(<MyTeam data={page()} />)
    const terms = [...container.querySelectorAll('.af-mt-key dt')].map((d) => d.textContent)
    expect(terms).toEqual(['H', 'Q', 'D', 'O', 'IR', 'DNP', '—', '⌂', '☀ ☁', 'Sleeper · AF', 'OWN · START'])
    const text = container.querySelector('.af-mt-key')!.textContent!
    expect(text).toContain('not the same as confirmed healthy')
    /* The same explainer the column heading's tooltip carries — the key cannot drift from it. */
    expect(text).toContain('re-scored under YOUR league’s settings')
  })
})

describe('phone: the countdown above the Sleeper check strip', () => {
  it('orders the countdown first on a narrow page only', () => {
    expect(inQuery(MT_CSS, '.af-core .af-mt > .af-mt-lock', NARROW_PAGE).order).toBe('-1')
    expect(inQuery(MT_CSS, '.af-core .af-mt > .af-mt-lock', '').order).toBeUndefined()
  })

  it('keeps team context first and the countdown above verification on phones', () => {
    /* Context stays first; the narrow CSS then puts the countdown ahead of verification. */
    const { container } = render(<MyTeam data={page()} />)
    const kids = [...container.querySelector('.af-mt')!.children].map((c) => c.classList)
    // 2026-11-13: the My team guide (what to do, in one sentence) leads; the team header follows it.
    expect(kids[0].contains('af-mtg-head')).toBe(true)
    expect(kids[1].contains('af-mt-head')).toBe(true)
    expect(inQuery(MT_CSS, '.af-core .af-mt > .af-mt-head', NARROW_PAGE).order).toBe('-2')
    expect(kids[2].contains('af-lv')).toBe(true)
    expect(kids[3].contains('af-mt-lock')).toBe(true)
  })
})
