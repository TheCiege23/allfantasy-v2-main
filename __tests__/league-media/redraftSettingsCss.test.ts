/**
 * redraft-settings.css (wave-2 A5): every rule carries BOTH halves of the redraft scope — the workspace
 * stamp and the page's own [data-rd-settings] marker — colours are tokens, the @media block is
 * top-level, nothing is under 11px, and the one derived ground the file introduces for text
 * (--rd-surface-elev under the sport-coloured value) still clears 4.5:1 in light mode.
 *
 * This is the static half of "other formats unchanged"; __tests__/league-settings/redraft-settings-render.test.tsx
 * is the markup half, and scripts/redraft-settings-capture.mjs diffs a dynasty control frame by pixels.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const RAW = readFileSync(join(process.cwd(), 'components/league-settings/home/redraft-settings.css'), 'utf8')
// Prose about a selector is not a selector.
const CSS = RAW.replace(/\/\*[\s\S]*?\*\//g, '')
const IDENTITY = readFileSync(join(process.cwd(), 'components/league/native/redraft-identity.css'), 'utf8')
const AF_CORE = readFileSync(join(process.cwd(), 'components/core-app/af-core.css'), 'utf8')

/** Every selector of every rule, with the @media it sits in (or null). Throws on a nested @media. */
function selectors(css: string): Array<{ selector: string; media: string | null }> {
  const out: Array<{ selector: string; media: string | null }> = []
  let depth = 0
  let media: string | null = null
  let buf = ''
  for (const ch of css) {
    if (ch === '{') {
      const head = buf.trim()
      buf = ''
      if (head.startsWith('@media')) {
        if (depth !== 0) throw new Error(`nested @media: ${head}`)
        media = head
      } else {
        for (const s of head.split(',')) out.push({ selector: s.trim(), media })
      }
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) media = null
      buf = ''
    } else if (depth === 0 || (media && depth === 1)) {
      buf += ch
    } else if (ch === ';') {
      buf = ''
    }
  }
  return out
}

const isScoped = (selector: string) =>
  /^\.nl-workspace\[data-format=redraft\]\s/.test(selector) && /\.lsh-root\[data-rd-settings\]/.test(selector)
const loose = (css: string) => selectors(css).filter((r) => !isScoped(r.selector)).map((r) => r.selector)

describe('redraft-settings.css', () => {
  const all = selectors(CSS)

  it('finds the rules at all (a parser that reads nothing passes everything)', () => {
    expect(all.length).toBeGreaterThan(30)
    expect(all.some((r) => r.media === '@media (max-width: 639.98px)')).toBe(true)
  })

  it('scopes every rule to the redraft workspace stamp AND the page marker', () => {
    expect(loose(CSS)).toEqual([])
  })

  it('positive control: a rule missing either half of the scope is reported', () => {
    const sample = [
      '.lsh-row { color: var(--text); }',
      '.nl-workspace[data-format=redraft] .lsh-row { color: var(--text); }',
      '.lsh-root[data-rd-settings] .lsh-row { color: var(--text); }',
      '.nl-workspace[data-format=redraft] .lsh-root[data-rd-settings] .lsh-row { color: var(--text); }',
    ].join('\n')
    expect(loose(sample)).toEqual(['.lsh-row', '.nl-workspace[data-format=redraft] .lsh-row', '.lsh-root[data-rd-settings] .lsh-row'])
  })

  it('uses tokens only: no hex and no rgb()/hsl() colour literals', () => {
    expect(CSS.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([])
    expect(CSS.match(/\b(?:rgba?|hsla?)\(/g) ?? []).toEqual([])
  })

  it('keeps every @media block at the top level (the af-matchup.css 560-inside-780 incident)', () => {
    expect(() => selectors(CSS)).not.toThrow()
    expect(() => selectors('@media (max-width: 780px) { .a { color: red } @media (max-width: 560px) { .b { color: red } } }')).toThrow(/nested/)
    expect(CSS.match(/@media/g)?.length).toBe(1)
  })

  it('declares no font size under the 11px floor', () => {
    const sizes = [...CSS.matchAll(/font(?:-size)?:\s*(?:[^;{}]*?\s)?(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]))
    expect(sizes.length).toBeGreaterThanOrEqual(5)
    expect(sizes.filter((n) => n < 11)).toEqual([])
  })

  it('re-points /core accent tokens on the settings root, above /core’s own light-mode block', () => {
    // `.lsh-root` is a second `.af-core`; html[data-mode=light] .af-core is (0,2,1). The re-point must beat it.
    const rule = all.find((r) => r.selector === '.nl-workspace[data-format=redraft] .af-core.lsh-root[data-rd-settings]' && r.media === null)
    expect(rule).toBeTruthy()
    expect(CSS).toMatch(/\.af-core\.lsh-root\[data-rd-settings\]\{\s*--accent:var\(--rd-accent-text\)/)
  })
})

// ── Light-mode contrast of the one ground this file adds under text ───────────────────────────────
function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}
function lum([r, g, b]: [number, number, number]) {
  const c = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b)
}
const ratio = (a: [number, number, number], b: [number, number, number]) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
const mix = (a: [number, number, number], b: [number, number, number], wa: number) =>
  a.map((v, i) => Math.round(v * wa + b[i] * (1 - wa))) as [number, number, number]

describe('redraft settings — light-mode value text on the lifted card', () => {
  const lightSurface = AF_CORE.match(/html\[data-mode='light'\] \.af-core \{[\s\S]*?--surface: (#[0-9a-f]{6})/)?.[1]
  const accents = [...IDENTITY.matchAll(/html\[data-mode='light'\] [^{]*\[data-sport=(\w+)\]\{--rd-accent:(#[0-9a-f]{6})/g)].map((m) => [m[1], m[2]] as const)

  it('reads the seven light accents and the light --surface from the shipped CSS', () => {
    expect(lightSurface).toBe('#ffffff')
    expect(accents.map(([s]) => s).sort()).toEqual(['mlb', 'nba', 'ncaab', 'ncaaf', 'nfl', 'nhl', 'soccer'])
  })

  it('--rd-accent-text on --rd-surface-elev (surface + 5% accent) clears 4.5:1 for every sport', () => {
    const surface = hexRgb(lightSurface!)
    for (const [sport, hex] of accents) {
      const accent = hexRgb(hex)
      const elev = mix(accent, surface, 0.05)
      expect({ sport, ok: ratio(accent, elev) >= 4.5 }).toEqual({ sport, ok: true })
    }
  })

  it('mutation control: the measure fails a too-light accent', () => {
    const surface = hexRgb('#ffffff')
    const tooLight = hexRgb('#3ddc84') // the DARK-mode NFL accent, which is what light mode must never use
    expect(ratio(tooLight, mix(tooLight, surface, 0.05)) >= 4.5).toBe(false)
  })
})
