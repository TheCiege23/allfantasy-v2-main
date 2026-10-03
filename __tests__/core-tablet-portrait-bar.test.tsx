import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss, { type AtRule, type Rule } from 'postcss'
import { fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Tablet PORTRAIT (721–900px) gets the phone's bottom bar instead of the side menu — user's
 * decision, 2026-10-03. Measured on the live site with the block injected:
 *
 *   768×1024   My Team 429px → 649px wide, nav hidden, bar shown, launcher clear of the bar
 *   820×1180   481px → 701px
 *   1024×768, 800×600, 1024×1366, 375×812   computed layout identical with and without
 *
 * 🛑 THE 2026-09-25 TABLET BLOCK EXISTS BECAUSE THIS BAND ONCE HAD NO NAV AT ALL, so the second
 * half of this file is a reachability guard: every destination in the side menu this band hides
 * must be reachable from the bar, its More sheet, or the rail footer.
 */

const CSS = readFileSync(resolve(__dirname, '../components/core-app/af-core-shell.css'), 'utf8')
const BAND = '(min-width: 721px) and (max-width: 900px) and (orientation: portrait)'
const S = ".af-core.af-shell:not([data-league-first='true'])"

function bandRules(): Rule[] {
  const out: Rule[] = []
  postcss.parse(CSS).walkAtRules('media', (a: AtRule) => {
    if (a.params !== BAND) return
    a.walkRules((r) => {
      out.push(r)
    })
  })
  return out
}
const decls = (selector: string) => {
  const r = bandRules().find((x) => x.selector === selector)
  const o: Record<string, string> = {}
  r?.walkDecls((d) => {
    o[d.prop] = d.value
  })
  return o
}

describe('the portrait-tablet band', () => {
  it('exists once, at top level, and only for PORTRAIT — a narrow desktop window keeps its menu', () => {
    const blocks: AtRule[] = []
    postcss.parse(CSS).walkAtRules('media', (a: AtRule) => {
      if (a.params === BAND) blocks.push(a)
    })
    expect(blocks).toHaveLength(1)
    expect(blocks[0].parent?.type).toBe('root')
  })

  it('swaps the side menu for the bar, and drops the nav column from the grid', () => {
    expect(decls(`${S} .af-nav`).display).toBe('none')
    expect(decls(`${S} .af-tabbar`)).toMatchObject({ display: 'grid', position: 'fixed', bottom: '0' })
    expect(decls(`${S}:not([data-rail-open='true'])`)['grid-template-columns']).toBe('68px minmax(0, 1fr)')
  })

  it('lifts the chat launcher over the bar, and only when the standard shell is on screen', () => {
    expect(decls(`:root:has(${S})`)['--af-fab-bottom']).toBe('var(--af-fab-inset-phone)')
  })

  it('carries the More sheet with it — a bar whose More opens nothing would strand every other screen', () => {
    expect(decls(`${S} .af-mobile-more`)).toMatchObject({ position: 'fixed', display: 'flex' })
    expect(decls(`${S} .af-mobile-more-scrim`).position).toBe('fixed')
  })

  it('scopes every rule to the standard shell — league-first keeps its own layout', () => {
    const stray = bandRules()
      .flatMap((r) => r.selectors)
      .filter((sel) => !sel.startsWith(S) && sel !== `:root:has(${S})`)
    expect(stray).toEqual([])
  })
})

/* ── Reachability ──────────────────────────────────────────────────────────── */

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

afterEach(() => {
  document.body.style.overflow = ''
})

const LEAGUES = [
  { id: 'l1', name: 'Dynasty Warriors', platform: 'sleeper', mark: 'DW' },
  { id: 'l2', name: 'Pirate League', platform: 'sleeper', mark: 'PL' },
]
const path = (a: Element) => {
  const u = new URL((a as HTMLAnchorElement).href, 'http://x')
  return u.pathname + u.search
}

describe('nothing the side menu offers is lost when the band hides it', () => {
  for (const selectedLeagueId of [undefined, 'l1']) {
    it(`every side-menu link is in the bar, the More sheet or the rail footer (${selectedLeagueId ? 'in a league' : 'all leagues'})`, () => {
      const { container, getByRole } = render(
        <AfCoreShell
          active="home"
          leagues={LEAGUES as never}
          selectedLeagueId={selectedLeagueId}
          syncAge={{ label: 'just now', stale: false }}
          syncEligibleCount={0}
        >
          <div>screen</div>
        </AfCoreShell>,
      )
      const menu = [...container.querySelectorAll('.af-nav a[href]')].map(path)
      expect(menu.length).toBeGreaterThan(5)

      fireEvent.click(getByRole('button', { name: 'More' }))
      const reachable = new Set([
        ...[...container.querySelectorAll('.af-tabbar a[href]')].map(path),
        ...[...document.querySelectorAll('.af-mobile-more a[href]')].map(path),
        ...[...container.querySelectorAll('.af-rail-foot a[href]')].map(path),
      ])
      expect([...new Set(menu)].filter((h) => !reachable.has(h))).toEqual([])
    })
  }
})
