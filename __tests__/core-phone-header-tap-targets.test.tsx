import { fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const nav = vi.hoisted(() => ({
  router: { push: () => {}, replace: () => {}, prefetch: () => {}, refresh: () => {} },
}))
vi.mock('next/navigation', () => ({
  useRouter: () => nav.router,
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/components/core-app/comms/CommsDock', () => ({ default: () => null }))
vi.mock('@/components/core-app/SyncNowButton', () => ({ default: () => null }))
vi.mock('@/components/core-app/GeoRestrictionNotice', () => ({ GeoRestrictionNotice: () => null }))
vi.mock('@/components/core-app/AfCrest', () => ({ AfCrest: () => null }))
vi.mock('@/components/MiniPlayerImg', () => ({ default: () => null }))

import AfCoreShell from '@/components/core-app/AfCoreShell'

const CSS = readFileSync(resolve(__dirname, '../components/core-app/af-core-shell.css'), 'utf8')

/** The text of the top-level block that starts with `header`, braces balanced. */
function block(header: string): string {
  const start = CSS.indexOf(header)
  expect(start, header).toBeGreaterThan(-1)
  let depth = 0
  for (let i = CSS.indexOf('{', start); i < CSS.length; i++) {
    if (CSS[i] === '{') depth++
    else if (CSS[i] === '}' && --depth === 0) return CSS.slice(start, i + 1)
  }
  throw new Error('unbalanced')
}

describe('phone header: search behind an icon in the default mode too', () => {
  it('renders the search toggle without league-first, and opening it marks the header open', () => {
    const { container } = render(
      <AfCoreShell active="home" leagues={[]} syncAge={{ label: 'just now', stale: false }} syncEligibleCount={0}>
        <div>screen</div>
      </AfCoreShell>,
    )
    const header = container.querySelector('.af-topbar')!
    expect(header.getAttribute('data-lf-search-open')).toBeNull()
    const toggle = screen.getByRole('button', { name: 'Search players and leagues' })
    fireEvent.click(toggle)
    expect(header.getAttribute('data-lf-search-open')).toBe('true')
    expect(screen.getByRole('button', { name: 'Close search' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('folds the default phone search behind the toggle, at top level of the stylesheet', () => {
    const phone = block("@media (max-width: 720px) {\n  html:has(.af-core.af-shell)")
    expect(phone).toMatch(/:not\(\[data-league-first='true'\]\) \.af-topbar \.af-search-wrap \{\s*display: none;/)
    expect(phone).toMatch(/\[data-lf-search-open='true'\] \.af-search-wrap \{\s*display: block;/)
    expect(phone).toMatch(/:not\(\[data-league-first='true'\]\) \.af-lf-search-btn \{[^}]*width: 44px;[^}]*height: 44px;/)
    expect(phone).toMatch(/html:has\(\.af-core\.af-shell\) \{\s*overscroll-behavior-y: contain;/)
  })
})

describe('tap targets and notch insets', () => {
  it('gives the small close, remove and search buttons a 44px touch area', () => {
    const coarse = block('@media (pointer: coarse) {\n  .af-sp-close,')
    for (const cls of ['af-sp-close', 'af-olk-chip-x', 'af-cm-close', 'af-pf-search-btn']) {
      expect(coarse).toContain(`.${cls}::after`)
    }
    expect(coarse).toMatch(/height: 44px;/)
  })

  it('pads the phone tab bar for left and right safe areas, not only the bottom', () => {
    // The PHONE bar's own rule (the one with the 6-column grid), not the tablet bar's, which
    // already had side insets — matching anywhere in the file passed on main.
    const phoneBar = CSS.slice(CSS.indexOf('grid-template-columns: repeat(6, 1fr);'))
    const padding = phoneBar.slice(0, phoneBar.indexOf('background:'))
    expect(padding).toContain('env(safe-area-inset-right, 0px)')
    expect(padding).toContain('env(safe-area-inset-left, 0px)')
    expect(padding).toContain('env(safe-area-inset-bottom, 0px)')
  })
})
