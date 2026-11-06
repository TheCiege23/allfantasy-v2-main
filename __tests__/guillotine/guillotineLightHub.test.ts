/**
 * The Guilly hub panel follows light mode (2026-11-06). The specialty shell (components/league/specialty) is shared
 * by ten formats and was always dark: in light mode the Guilly tab put a near-black panel inside a white page.
 *
 * How, so that nine formats cannot move:
 *  - every colour in specialty.module.css reads `var(--sp-x, <the literal it had>)`. Unset, that IS the literal, so
 *    dark mode — and every other format in either mode — renders the bytes it rendered before.
 *  - ONE rule sets the --sp-* tokens: light mode AND [data-specialty='guillotine'].
 *  - the hero (on dark artwork) and anything marked .stayDark (the chop moment, the phone header) reset every token
 *    to `initial` — a guaranteed-invalid value, so var() falls back to the dark literal inside them.
 * Text tokens are measured here against every light ground they sit on.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const SP = read('components/league/specialty/specialty.module.css').replace(/\/\*[\s\S]*?\*\//g, '')
const GL = read('components/guillotine/guillotine-specialty.module.css').replace(/\/\*[\s\S]*?\*\//g, '')
const TSX = read('components/guillotine/GuillotineSpecialtyHome.tsx')

/** Top-level rules as [selector, body]; nested blocks (@container/@media/@keyframes) are skipped whole. */
function rules(css: string): [string, string][] {
  const out: [string, string][] = []
  let i = 0
  while (i < css.length) {
    const open = css.indexOf('{', i)
    if (open < 0) break
    const sel = css.slice(i, open).trim()
    let depth = 0
    let close = open
    for (let k = open; k < css.length; k++) {
      if (css[k] === '{') depth++
      else if (css[k] === '}' && --depth === 0) { close = k; break }
    }
    if (!sel.startsWith('@')) out.push([sel, css.slice(open + 1, close)])
    i = close + 1
  }
  return out
}
function decls(body: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const d of body.split(';')) {
    const at = d.indexOf(':')
    if (at > 0) out[d.slice(0, at).trim()] = d.slice(at + 1).trim()
  }
  return out
}
const LIGHT_SEL = ":global(html[data-mode='light']) .sp[data-specialty='guillotine']"
const lightRule = rules(SP).find(([s]) => s === LIGHT_SEL)
const LIGHT = lightRule ? decls(lightRule[1]) : {}
const GL_LIGHT_SEL = ":global(html[data-mode='light']) .home"
const glLightRule = rules(GL).find(([s]) => s === GL_LIGHT_SEL)
const GL_LIGHT = glLightRule ? decls(glLightRule[1]) : {}

/** A token's light value as a colour literal: `var(--surface, #fff)` → `#fff`. */
function literal(v: string | undefined): string {
  expect(v, 'token not set in the light rule').toBeTruthy()
  const m = v!.match(/^var\(--[\w-]+,\s*(.+)\)$/)
  return (m ? m[1]! : v!).trim()
}
function rgba(c: string): [number, number, number, number] {
  const h = c.match(/^#([0-9a-f]{6})$/i)
  if (h) return [0, 2, 4].map((i) => parseInt(h[1]!.slice(i, i + 2), 16)).concat(1) as [number, number, number, number]
  const r = c.match(/^rgba?\(([^)]+)\)$/)
  expect(r, `not a colour: ${c}`).toBeTruthy()
  const p = r![1]!.split(',').map((x) => Number(x.trim()))
  return [p[0]!, p[1]!, p[2]!, p[3] ?? 1]
}
const over = (fg: number[], bg: number[]) => [0, 1, 2].map((i) => fg[i]! * fg[3]! + bg[i]! * (1 - fg[3]!)).concat(1)
function lum([r, g, b]: number[]) {
  const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!)
}
function contrast(fg: string, ...grounds: string[]) {
  // Composite the grounds bottom-up onto white (the page), then the text.
  let bg = [255, 255, 255, 1]
  for (const g of grounds) bg = over(rgba(g), bg)
  const t = over(rgba(fg), bg)
  const [a, b] = [lum(t), lum(bg)]
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
const L = (t: string) => literal(LIGHT[t])

describe('the shared shell stays byte-identical in dark mode and for every other format', () => {
  it('every token read carries its dark literal as the fallback', () => {
    expect(SP).not.toMatch(/var\(--sp-[\w-]+\s*\)/)
    expect(GL).not.toMatch(/var\(--(sp|gl)-[\w-]+\s*\)/)
    expect(TSX).not.toMatch(/var\(--(sp|gl)-[\w-]+\s*\)/)
  })

  it('exactly one rule sets --sp-* values, and it is light mode + guillotine', () => {
    expect(lightRule, `no rule "${LIGHT_SEL}"`).toBeTruthy()
    // The lookahead holds the whitespace too: `\s*(?!initial)` would match zero spaces and slip past " initial".
    const setters = rules(SP).filter(([, b]) => /--sp-[\w-]+\s*:(?!\s*initial)/.test(b)).map(([s]) => s)
    expect(setters).toEqual([LIGHT_SEL])
  })

  it('the hero and .stayDark reset every token the light rule sets, so they stay dark', () => {
    const reset = rules(SP).find(([s]) => s.split(',').map((x) => x.trim()).sort().join(',') === '.hero,.stayDark')
    expect(reset, 'no ".hero, .stayDark" reset rule').toBeTruthy()
    const r = decls(reset![1])
    for (const k of Object.keys(LIGHT)) expect(r[k], `${k} not reset`).toBe('initial')
    for (const k of Object.keys(GL_LIGHT)) expect(r[k], `${k} not reset`).toBe('initial')
    // An inherited colour is computed where it is declared (.sp, light), so the reset must re-declare it: the hero's
    // link-buttons inherit (`.nl-workspace a { color: inherit }` beats `.btn`) and went dark-on-dark without this.
    expect(r.color).toBe('var(--sp-text, #e8eaf2)')
  })
})

describe('link-buttons, which inherit their colour', () => {
  it('a primary button keeps its ink in light mode (an <a> inherits the panel text otherwise)', () => {
    const r = rules(SP).find(([s]) => s === `${LIGHT_SEL} .btnP`)
    expect(r, 'no light-mode .btnP ink rule').toBeTruthy()
    expect(decls(r![1]).color).toBe('var(--accInk)')
  })
})

describe('light-mode text clears 4.5:1 on every ground it sits on', () => {
  const GROUNDS = ['--sp-bg', '--sp-card', '--sp-card2', '--sp-row', '--sp-btn', '--sp-clock']
  it.each(['--sp-text', '--sp-t2', '--sp-t3', '--sp-acc-text', '--sp-muted'])('%s', (t) => {
    for (const g of GROUNDS) expect(contrast(L(t), L(g)), `${t} on ${g}`).toBeGreaterThanOrEqual(4.5)
  })

  it.each(['safe', 'danger', 'zone', 'gold', 'pink', 'muted'])('%s tag text on its own tint, on a row and on a card', (tone) => {
    for (const g of ['--sp-row', '--sp-card']) {
      expect(contrast(L(`--sp-${tone}`), L(g), L(`--sp-${tone}-soft`)), `${tone} on ${g}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('the Guilly-only tokens (big margins) clear it too', () => {
    expect(glLightRule, `no rule "${GL_LIGHT_SEL}"`).toBeTruthy()
    for (const t of ['--gl-safe-big', '--gl-danger-big', '--gl-zone-big']) {
      for (const g of ['--sp-card', '--sp-row']) expect(contrast(literal(GL_LIGHT[t]), L(g)), `${t} on ${g}`).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('the Guilly component reads tokens, not dark literals', () => {
  const [home, moment] = TSX.split('export function GuillotineChopMoment')
  it('passes its own class to the shell, so the --gl light rule reaches it', () => {
    expect(home).toMatch(/<SpecialtyShell[^>]*className=\{gl\.home\}/)
  })

  it('outside the chop moment, no dark-only text or ground literal is used bare', () => {
    // Bar fills are gradients that read on either ground; text and row grounds are what must follow the mode.
    const bare = (home ?? '').replace(/var\(--[\w-]+,\s*[^)]*\)/g, '').replace(/linear-gradient\([^)]*\)/g, '')
    for (const c of ['#151a28', '#7fe0a6', '#ffc46b', '#ff9a8a', '#ffb0a4', '#a3a9c2']) expect(bare, c).not.toContain(c)
  })

  it('the chop moment and the phone header stay dark on purpose', () => {
    expect(moment).toMatch(/className=\{`\$\{sp\.card\} \$\{sp\.pad\} \$\{sp\.stayDark\}/)
    expect(home).toMatch(/className=\{`\$\{gl\.phoneHead\} \$\{sp\.stayDark\}`\}/)
  })

  it('the Guilly stylesheet reads tokens for its text colours', () => {
    const top = GL.slice(0, GL.indexOf('.stage'))
    const bare = top.replace(/var\(--[\w-]+,\s*[^)]*\)/g, '')
    for (const c of ['#7d84a3', '#8d93ad', '#ff9a8a', '#bff3d0', '#ffd59a', '#ffb0a4']) expect(bare, c).not.toContain(c)
  })
})
