/**
 * The Dynasty Era identity on /core: which leagues get it (`coreShellDynasty`, the workspace's own
 * `usesDynastyBackground` rule with the fresh league record winning over the list row), the shell's
 * stamp, and the CSS that makes the stamp mean something — with its gold measured against every /core
 * ground in every mode, read from the SHIPPED files rather than a copy of their values.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { coreShellDynasty } from '@/lib/core-app/coreShellDynasty'

const nav = vi.hoisted(() => ({ router: { push: () => {}, replace: () => {}, prefetch: () => {}, refresh: () => {} } }))
vi.mock('next/navigation', () => ({
  useRouter: () => nav.router,
  usePathname: () => '/core/my-team',
  useSearchParams: () => new URLSearchParams('league=l1'),
}))
vi.mock('@/components/core-app/comms/CommsDock', () => ({ default: () => null }))
vi.mock('@/components/core-app/SyncNowButton', () => ({ default: () => null }))
vi.mock('@/components/core-app/GeoRestrictionNotice', () => ({ GeoRestrictionNotice: () => null }))
vi.mock('@/components/core-app/AfCrest', () => ({ AfCrest: () => null }))
vi.mock('@/components/MiniPlayerImg', () => ({ default: () => null }))

import AfCoreShell from '@/components/core-app/AfCoreShell'

describe('coreShellDynasty', () => {
  it('a dynasty league, by any of the fields isDynastyLeague reads, gets the identity', () => {
    expect(coreShellDynasty({ isDynasty: true })).toBe(true)
    expect(coreShellDynasty({ leagueType: 'DYNASTY' })).toBe(true)
    expect(coreShellDynasty({ leagueVariant: 'dynasty_idp' })).toBe(true)
    expect(coreShellDynasty({ format: 'dynasty' })).toBe(true)
  })

  it('no league, a redraft league, and a guillotine or survivor league keep the default look', () => {
    expect(coreShellDynasty(null)).toBe(false)
    expect(coreShellDynasty({ isDynasty: false, leagueType: 'redraft', format: 'redraft' })).toBe(false)
    expect(coreShellDynasty({ isDynasty: true, guillotineMode: true })).toBe(false)
    expect(coreShellDynasty({ isDynasty: true, leagueType: 'survivor' })).toBe(false)
  })

  it('the fresh league record wins over a stale list row, including its derived format', () => {
    // List row says dynasty; the league itself was reclassified to redraft.
    expect(
      coreShellDynasty({ isDynasty: true, leagueType: 'dynasty', format: 'dynasty' }, { isDynasty: false, leagueType: 'redraft', leagueVariant: null }),
    ).toBe(false)
    // List row lags the other way.
    expect(coreShellDynasty({ isDynasty: false, leagueType: 'redraft', format: 'redraft' }, { isDynasty: true })).toBe(true)
    // A fresh record that says nothing about a field leaves the row's value.
    expect(coreShellDynasty({ isDynasty: true }, { guillotineMode: undefined })).toBe(true)
  })
})

const LEAGUES = [{ id: 'l1', name: 'The Deep!', platform: 'sleeper', mark: 'TD', sport: 'NFL' }]
function root(props: Record<string, unknown>) {
  const { container } = render(
    <AfCoreShell active="my-team" leagues={LEAGUES as never} syncAge={{ label: 'just now', stale: false }} syncEligibleCount={0} {...props}>
      <div>screen</div>
    </AfCoreShell>,
  )
  return container.querySelector('.af-core.af-shell')!
}

describe('AfCoreShell dynasty stamp', () => {
  it('stamps data-dynasty-background=true for a dynasty league', () => {
    expect(root({ selectedLeagueId: 'l1', dynastyEra: true }).getAttribute('data-dynasty-background')).toBe('true')
  })
  it('stamps nothing when the prop is false or absent', () => {
    expect(root({ selectedLeagueId: 'l1', dynastyEra: false }).hasAttribute('data-dynasty-background')).toBe(false)
    expect(root({}).hasAttribute('data-dynasty-background')).toBe(false)
  })
  it('a redraft sport or a league theme wins — the two identities never stack', () => {
    expect(root({ selectedLeagueId: 'l1', dynastyEra: true, redraftSport: 'nfl' }).hasAttribute('data-dynasty-background')).toBe(false)
    expect(root({ selectedLeagueId: 'l1', dynastyEra: true, leagueTheme: 'survivor' }).hasAttribute('data-dynasty-background')).toBe(false)
  })
})

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')
type RGB = [number, number, number]
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.trim().slice(i, i + 2), 16) / 255) as RGB
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const lum = ([r, g, b]: RGB) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
const contrast = (a: RGB, b: RGB) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const over = (fg: RGB, a: number, bg: RGB): RGB => fg.map((c, i) => c * a + bg[i] * (1 - a)) as RGB

/** The value of `--name` in the first block whose selector text is exactly `selector`. */
function token(css: string, selector: string, name: string): string {
  const body = strip(css)
  let from = 0
  for (;;) {
    const at = body.indexOf(selector, from)
    if (at < 0) throw new Error(`no block for ${selector}`)
    const open = at + selector.length
    if (body.slice(open).trimStart().startsWith('{')) {
      const block = body.slice(body.indexOf('{', open) + 1, body.indexOf('}', open))
      const m = block.match(new RegExp(`(?:^|[;\\s])${name}\\s*:\\s*([^;]+)`))
      if (!m) throw new Error(`${name} not in ${selector}`)
      return m[1].trim()
    }
    from = open
  }
}

describe('af-core-dynasty.css', () => {
  const css = read('components/core-app/af-core-dynasty.css')
  const core = read('components/core-app/af-core.css')
  const DARK = '.af-core.af-shell[data-dynasty-background=true]'
  const LIGHT = "html[data-mode='light'] .af-core.af-shell[data-dynasty-background=true]"
  const PALETTES = { dark: '.af-core', af: "html[data-mode='af'] .af-core", light: "html[data-mode='light'] .af-core" }
  const ground = (palette: string, name: string) => hex(token(core, palette, name))

  it('the shell loads it, and /core accent names follow the dynasty tokens', () => {
    expect(read('components/core-app/AfCoreShell.tsx')).toContain("import '@/components/core-app/af-core-dynasty.css'")
    expect(token(css, DARK, '--accent')).toBe('var(--dyn-accent-text)')
    expect(token(css, DARK, '--accent-ink')).toBe('var(--dyn-accent-ink)')
    expect(token(css, DARK, '--accent-soft')).toBe('var(--dyn-accent-soft)')
    expect(token(css, DARK, '--accent-line')).toBe('var(--dyn-accent-line)')
  })

  it('accent text clears 4.5:1 on every ground, in dark, AF and light', () => {
    const darkText = hex(token(css, DARK, '--dyn-accent-text'))
    const lightText = hex(token(css, LIGHT, '--dyn-accent-text'))
    const cases: Array<[string, RGB]> = [[PALETTES.dark, darkText], [PALETTES.af, darkText], [PALETTES.light, lightText]]
    for (const [palette, text] of cases) {
      for (const g of ['--bg', '--surface', '--surface2']) {
        expect(contrast(text, ground(palette, g)), `${palette} ${g}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('the ink on a gold fill clears 4.5:1 in both palettes', () => {
    expect(contrast(hex(token(css, DARK, '--dyn-accent-ink')), hex(token(css, DARK, '--dyn-gold')))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(hex(token(css, LIGHT, '--dyn-accent-ink')), hex(token(css, LIGHT, '--dyn-accent-text')))).toBeGreaterThanOrEqual(4.5)
  })

  it('accent text still clears 4.5:1 on its own tint (a first-round pick chip)', () => {
    const gold = hex(token(css, DARK, '--dyn-gold'))
    const darkText = hex(token(css, DARK, '--dyn-accent-text'))
    for (const palette of [PALETTES.dark, PALETTES.af]) {
      expect(contrast(darkText, over(gold, 0.16, ground(palette, '--surface2')))).toBeGreaterThanOrEqual(4.5)
    }
    const lightText = hex(token(css, LIGHT, '--dyn-accent-text'))
    expect(contrast(lightText, over(lightText, 0.1, ground(PALETTES.light, '--surface2')))).toBeGreaterThanOrEqual(4.5)
  })

  it('has exactly one top-level @media block and nothing nested in it', () => {
    const body = strip(css)
    expect(body.match(/@media/g)?.length).toBe(1)
    const inner = body.slice(body.indexOf('@media'))
    expect(inner.slice(inner.indexOf('{') + 1).includes('@media')).toBe(false)
  })
})
