// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

/**
 * Rankings → My portfolio, simplified (2026-11-24). On a phone the tab measured ~3,570px:
 *  - a league-season card was three lines (league + record, INDEX/FINISH, MANAGER SCORE/More). Index now
 *    sits behind the row's More and the score's chip reads "Score" (full name kept for screen readers),
 *    so Finish, Score and More share one line — 83px a row at 390px (Playwright), from ~112px;
 *  - "Where your XP came from" is one closed row with the total; a saved total that disagrees with
 *    today's rules stays outside the fold.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/core/rankings',
  useSearchParams: () => new URLSearchParams('scope=portfolio'),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, scroll: _s, prefetch: _p, ...rest }: { href: string; children: React.ReactNode; scroll?: boolean; prefetch?: unknown }) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}))

import { Rankings } from '@/components/core-app/screens/Rankings'
import { data } from '@/app/e2e/rankings-guide/sampleData'

afterEach(cleanup)

function portfolioTab(over: Record<string, unknown> = {}) {
  return render(<Rankings data={{ ...data('mid', null, 'portfolio'), ...over } as never} />).container
}

describe('My portfolio, plain', () => {
  it('a league-season shows Finish and Score as chips; Index is behind More, with its full name', () => {
    const c = portfolioTab()
    const row = c.querySelector('.af-rk-cards tbody tr[data-phonemore]')!
    const chips = [...row.querySelectorAll('[data-card="detail"]:not(.af-rk-hide-phone)')].map((td) => td.getAttribute('data-label'))
    expect(chips).toEqual(['Finish', 'Score'])
    const index = row.querySelector('[data-card="detail"][data-label="Index"]')!
    expect(index.classList.contains('af-rk-hide-phone')).toBe(true)
    expect(row.querySelector('.af-rk-phonemore')?.textContent).toContain('Scoring index, 100 is average for the format')
    // The score column keeps its full name for assistive tech.
    expect(c.querySelector('thead')?.textContent).toContain('Manager score')
  })

  it('folds where the XP came from, with the total on the closed row', () => {
    const c = portfolioTab()
    const fold = c.querySelector('[data-testid="rk-xp-fold"]') as HTMLDetailsElement
    expect(fold.open).toBe(false)
    expect(fold.querySelector('summary')?.textContent).toBe('Where your XP came from 46,956 XP')
    expect(fold.textContent).toContain('82 wins × 10')
  })

  it('a saved total that disagrees with today’s rules is said outside the fold', () => {
    const c = portfolioTab({ reconciliation: { computed: 970, stored: 900, storedAt: '2026-11-01T00:00:00.000Z', matches: false } })
    const warn = c.querySelector('.af-rk-note--warn')!
    expect(warn.textContent).toContain('Your saved total is 900 XP')
    expect(warn.closest('details')).toBeNull()
  })
})

/*
 * One league, simplified (2026-11-24): the level card (career XP) is the Community board's, not this tab's,
 * and the Points-for chart — the table's PF column again — is not drawn on a phone (CSS; measured with
 * Playwright: hidden at 390px, shown at 1280px). /e2e/rankings-guide?scope=league: 2,747px → 2,141px.
 */
describe('One league, plain', () => {
  it('draws the standings without the level card; the Community board keeps it', () => {
    const league = render(<Rankings data={data('mid', null, 'league') as never} />).container
    expect(league.querySelector('[data-testid="rk-levelcard"]')).toBeNull()
    expect(league.querySelectorAll('.af-rk-cards tbody tr').length).toBeGreaterThanOrEqual(12)
    cleanup()
    const community = render(<Rankings data={data('mid', null, 'global') as never} />).container
    expect(community.querySelector('[data-testid="rk-levelcard"]')).not.toBeNull()
  })

  it('hides the Points-for chart on a phone only', () => {
    const css = readFileSync(resolve(process.cwd(), 'components/core-app/af-rankings-screen.css'), 'utf8')
    expect(css).toMatch(/@media \(max-width: 720px\) \{\s*\.af-rk-scope-grid \.af-rk-pfchart \{ display: none; \}\s*\}/)
  })
})

/*
 * Class, simplified (2026-11-24): the note on how the rating moves is one closed row under the weeks, and
 * a board row whose only visible chip is "More" puts it beside the sub-line (CSS; Playwright at 320–430px:
 * ~100px → 62px a row, no name/score overlap). /e2e/rankings-guide?scope=class: 3,005px → 2,609px.
 */
describe('Class, plain', () => {
  it('folds how the rating moves under the rated weeks', () => {
    const c = render(<Rankings data={data('mid', null, 'class') as never} />).container
    const fold = c.querySelector('[data-testid="rk-class-why"]') as HTMLDetailsElement
    expect(fold.open).toBe(false)
    expect(fold.querySelector('summary')?.textContent).toBe('How your rating moves')
    expect(fold.textContent).toContain('everyone in your league')
    expect(c.querySelector('#rk-class-games')?.contains(fold)).toBe(true)
  })

  it('puts a lone More beside the sub-line, on phones only, without touching rows with chips', () => {
    const css = readFileSync(resolve(process.cwd(), 'components/core-app/af-rankings-screen.css'), 'utf8')
    const lone = "tr[data-phonemore]:not(:has(> [data-card='detail']:not(.af-rk-hide-phone)))"
    // In order: the note, the phone media query that opens right after it, then the rule inside it.
    const note = css.indexOf('Phone rows whose only visible chip is "More"')
    const media = css.indexOf('@media (max-width: 720px) {', note)
    const rule = css.indexOf(`.af-rk-cards ${lone} {`, media)
    expect(note).toBeGreaterThan(-1)
    expect(media).toBeGreaterThan(note)
    expect(rule).toBeGreaterThan(media)
    expect(css.slice(media, rule)).not.toContain('}\n}')
    expect(css).toContain(`.af-rk-cards ${lone} > td.af-rk-phonemore {\n    grid-column: 2;\n    grid-row: 2;`)
  })
})
