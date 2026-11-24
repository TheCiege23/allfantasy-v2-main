// @vitest-environment jsdom
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
