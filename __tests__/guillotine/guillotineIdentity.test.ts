/**
 * Guillotine identity (2026-11-06): ember instead of pink and cyan, and a Guilly hub that reads in light
 * mode. Before this, GuillotineTab forced `text-[#e6edf3]` on its root and every card used dark Tailwind
 * utilities, so in light mode the survival table's numbers were near-white on white and the selected
 * "Hub" sub-tab's label vanished. Now every colour is a `--gl-*` token (components/guillotine/guillotine-identity.css).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '')
const IDENTITY = strip(read('components/guillotine/guillotine-identity.css'))
const CORE = strip(read('components/core-app/af-core.css'))

const PARTS = [
  'app/league/[leagueId]/tabs/GuillotineTab.tsx',
  'components/guillotine/GuillotineHome.tsx',
  'components/guillotine/GuillotineSurvivalHistory.tsx',
  'components/guillotine/GuillotineAIPanel.tsx',
  'components/guillotine/GuillotineNextChopPick.tsx',
]

/** Declarations of the first top-level rule whose selector is exactly `selector`. */
function block(css: string, selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = css.match(new RegExp(`(?:^|})\\s*${esc}\\s*\\{([^}]*)\\}`, 'm'))
  expect(m, `no rule for ${selector}`).not.toBeNull()
  return m![1]!
}
const prop = (decls: string, name: string) => {
  const m = decls.match(new RegExp(`${name}\\s*:\\s*([^;]+)`))
  expect(m, `no ${name}`).not.toBeNull()
  return m![1]!.trim()
}

function lum(hex: string) {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!)
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}
const mix = (fg: string, bg: string, a: number) =>
  '#' + [0, 2, 4].map((i) => Math.round(parseInt(fg.slice(1 + i, 3 + i), 16) * a + parseInt(bg.slice(1 + i, 3 + i), 16) * (1 - a)).toString(16).padStart(2, '0')).join('')

describe('ember identity', () => {
  const dark = block(IDENTITY, ':is(.gl,.af-core.nl-workspace[data-format=guillotine])')
  const light = block(IDENTITY, "html[data-mode='light'] :is(.gl,.af-core.nl-workspace[data-format=guillotine])")
  const coreDark = block(CORE, '.af-core')
  const coreLight = block(CORE, "html[data-mode='light'] .af-core")
  const grounds = (d: string) => ['--surface', '--surface2', '--bg'].map((n) => prop(d, n))

  it('light ember clears 5.1:1 on every light ground, on its own tint, and under white text', () => {
    const ember = prop(light, '--gl-ember-text')
    for (const g of grounds(coreLight)) {
      expect(contrast(ember, g), `on ${g}`).toBeGreaterThanOrEqual(5.1)
      expect(contrast(ember, mix(ember, g, 0.1)), `on its tint over ${g}`).toBeGreaterThanOrEqual(5.1)
    }
    expect(contrast('#ffffff', prop(light, '--gl-ember'))).toBeGreaterThanOrEqual(4.5)
  })

  it('dark ember clears 4.5:1 on every dark ground and on its own tint', () => {
    const ember = prop(dark, '--gl-ember-text')
    for (const g of grounds(coreDark)) {
      expect(contrast(ember, g), `on ${g}`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(ember, mix(ember, g, 0.14)), `on its tint over ${g}`).toBeGreaterThanOrEqual(4.5)
    }
    expect(contrast(prop(dark, '--gl-ember-ink'), prop(dark, '--gl-ember'))).toBeGreaterThanOrEqual(4.5)
  })

  it("maps /core's accent to ember in a guillotine workspace, which loads the file", () => {
    const ws = block(IDENTITY, '.af-core.nl-workspace[data-format=guillotine]')
    expect(prop(ws, '--accent')).toBe('var(--gl-ember-text)')
    expect(read('components/league/native/NativeLeagueWorkspace.tsx')).toMatch(/import '@\/components\/guillotine\/guillotine-identity\.css'/)
  })
})

describe('the Guilly hub reads in both modes', () => {
  it.each(PARTS)('%s uses tokens, not dark-only colours', (file) => {
    const src = read(file)
    const hits = src.match(/\b(?:text|bg|border|ring)-(?:white|black|cyan|rose|amber|emerald|\[#)[^\s"'`]*/g) ?? []
    expect(hits, 'dark-only utilities').toEqual([])
    expect(src).not.toMatch(/#ff3d81|#e6edf3/i)
  })

  it.each(PARTS)('%s roots itself in the .gl scope', (file) => {
    // Every part that can render on its own carries `gl` on its outermost element, so the tokens exist
    // wherever it is mounted (GuillotineAIPanel also renders in IntelligenceTab).
    expect(read(file)).toMatch(/className=\{?[`"]gl[\s`"]/)
  })

  it('a link carrying an ember text class outranks the workspace link reset', () => {
    // native-league.css has `.nl-workspace a{color:inherit}` at (0,1,1); a one-class rule loses to it and
    // "Open Waivers →" rendered in body text. Every text-colour class is two classes, (0,2,0).
    expect(strip(read('components/league/native/native-league.css'))).toMatch(/\.nl-workspace a\s*\{[^}]*color:\s*inherit/)
    for (const name of ['text', 'text2', 'muted', 'accent-text', 'good', 'warn', 'bad']) {
      expect(IDENTITY, name).toMatch(new RegExp(`(?:^|\\})\\s*\\.gl \\.gl-${name},\\.gl\\.gl-${name}\\s*\\{`, 'm'))
    }
  })

  it('the selected sub-tab is an ember tint with ember text', () => {
    const on = block(IDENTITY, '.gl-subtab[aria-pressed=true]')
    expect(prop(on, 'color')).toBe('var(--gl-ember-text)')
    expect(prop(on, 'background')).toBe('var(--gl-ember-soft)')
  })
})
