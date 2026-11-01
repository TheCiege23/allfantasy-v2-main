import { render } from '@testing-library/react'
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
import { CORE_NAV_LABELS, navLabel } from '@/lib/core-app/navLabels'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8')

describe('one label table', () => {
  it('gives every label and short label a Spanish translation', () => {
    for (const entry of Object.values(CORE_NAV_LABELS) as Array<{ label: string; short?: string }>) {
      for (const english of [entry.label, entry.short].filter(Boolean) as string[]) {
        expect(coreUiCopy(english, 'es'), english).not.toBe(english)
      }
    }
  })

  it('is what the shell, the league tabs and the error panels read — no private spellings left', () => {
    const shell = read('components/core-app/AfCoreShell.tsx')
    const tabs = read('components/core-app/LeagueTabs.tsx')
    const page = read('app/core/(shell)/[[...screen]]/page.tsx')
    expect(tabs).not.toMatch(/label: '(My Team|My team|Players|Live|Outlook|Overview)'/)
    expect(page).not.toContain('screen="Trade Center"')
    expect(page).not.toContain('screen="Your Week"')
    expect(page).toContain("screen={navLabel('trades')}")
    expect(shell).toContain("label: navLabel('players')")
    expect(navLabel('players', 'short')).toBe('Players')
    expect(navLabel('trades', 'short')).toBe('Trades')
  })
})

describe('one icon system on the bars', () => {
  function shellBars(props: Record<string, unknown> = {}) {
    return render(
      <AfCoreShell active="home" leagues={[]} syncAge={{ label: 'just now', stale: false }} syncEligibleCount={0} {...props}>
        <div>screen</div>
      </AfCoreShell>,
    ).container
  }

  it('draws every phone tab bar and nav strip icon as an SVG, not a unicode character', () => {
    for (const container of [shellBars(), shellBars({ leagueFirst: true })]) {
      const glyphs = [...container.querySelectorAll('.af-tabbar-glyph, .af-nav-glyph')]
      expect(glyphs.length).toBeGreaterThan(4)
      for (const g of glyphs) {
        expect(g.querySelector('svg'), g.outerHTML).not.toBeNull()
        // Text left inside the icon slot (outside a badge dot) would be a leftover glyph.
        const stray = [...g.childNodes].filter((n) => n.nodeType === 3 && (n.textContent ?? '').trim() !== '')
        expect(stray, g.outerHTML).toEqual([])
      }
    }
  })
})
