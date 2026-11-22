/**
 * 🛑 `bg-[var(--zombie-crimson)]/15` COMPILES TO NOTHING.
 *
 * Tailwind 3 cannot apply an opacity modifier to a colour it only knows as a CSS variable, so it drops the class
 * without a warning and the element renders transparent (a border falls back to the default grey). 57 such classes
 * across 31 files were silently doing nothing (2026-11-09): Zombie's crimson active tabs and status badges, the
 * tournament gold and cut-line tints, Survivor's torch accents, the create-league video tile's gradient, the
 * discovery cards' hover border. 48 IDP and cap ones were fixed the same way in #3453.
 *
 * Two working forms:
 *  - a Tailwind palette over RGB-channel tokens (`bg-zombie-crimson/15`), for a hex token defined once; and
 *  - `color-mix()` (`bg-[color:color-mix(in_srgb,var(--accent)_30%,transparent)]`), for a token that is
 *    redefined per theme or scope, or aliases another variable — it follows whatever value is in scope.
 *
 * This compiles each form through Tailwind with the repo's own config, and sweeps app/ and components/ for the
 * broken form.
 */
import fs from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import tailwind from 'tailwindcss'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const config = require(path.join(ROOT, 'tailwind.config.js'))
const BROKEN = /[a-z]-\[(?:color:)?var\(--[a-z0-9-]+\)\]\/\d/

async function compile(classes: string): Promise<string> {
  const out = await postcss([
    tailwind({ ...config, content: [{ raw: `<div class="${classes}"></div>`, extension: 'html' }], corePlugins: { preflight: false } }),
  ]).process('@tailwind utilities;', { from: undefined })
  return out.css
}

function sources(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') sources(rel, out)
    } else if (/\.(tsx?|jsx?)$/.test(rel)) out.push(rel)
  }
  return out
}

describe('colour classes with an opacity', () => {
  it('positive control: the var() form emits no rule at all', async () => {
    const css = await compile('bg-[var(--zombie-crimson)]/15 border-[color:var(--accent)]/30')
    expect(css).not.toContain('--zombie-crimson')
    expect(css).not.toContain('--accent')
  })

  it('emits a real colour for the palette form', async () => {
    const css = await compile('bg-zombie-crimson/15 border-tournament-gold/40')
    expect(css).toContain('rgb(var(--zombie-crimson-rgb) / 0.15)')
    expect(css).toContain('rgb(var(--tournament-gold-rgb) / 0.4)')
  })

  it('emits a real colour for the color-mix form, gradients included', async () => {
    const css = await compile(
      'hover:border-[color:color-mix(in_srgb,var(--accent)_35%,transparent)] from-[color:color-mix(in_srgb,var(--surface-card-soft)_90%,transparent)]',
    )
    expect(css).toContain('color-mix(in srgb,var(--accent) 35%,transparent)')
    expect(css).toContain('color-mix(in srgb,var(--surface-card-soft) 90%,transparent)')
  })

  it('keeps every channel token equal to its hex token', () => {
    const globals = read('app/globals.css')
    for (const family of ['zombie', 'tournament', 'cap', 'idp']) {
      const keys = Object.keys(config.theme.extend.colors[family] ?? {})
      expect(keys.length, family).toBeGreaterThan(0)
      for (const key of keys) {
        const hex = new RegExp(`--${family}-${key}:\\s*#([0-9a-f]{6});`, 'i').exec(globals)?.[1]
        const channels = new RegExp(`--${family}-${key}-rgb:\\s*([0-9 ]+);`).exec(globals)?.[1]
        expect(hex, `${family}-${key}`).toBeTruthy()
        expect(channels?.trim().split(/\s+/).map(Number), `${family}-${key}`).toEqual([0, 2, 4].map((i) => parseInt(hex!.slice(i, i + 2), 16)))
      }
    }
  })

  // The second way to get nothing: an opacity off Tailwind's scale (multiples of 5, plus the extra steps listed in
  // tailwind.config.js `theme.extend.opacity`). An off-scale step emits no rule even on a real palette colour; it
  // must be bracketed. Five zombie/tournament badges and an IDP card did this. `/13` is off both scales (`/12` is
  // now one of the extra steps, so it compiles).
  it('positive control: an off-scale opacity emits nothing, the bracketed form does', async () => {
    expect(await compile('bg-zombie-crimson/13')).not.toContain('--zombie-crimson-rgb')
    expect(await compile('bg-zombie-crimson/[0.13]')).toContain('rgb(var(--zombie-crimson-rgb) / 0.13)')
  })

  it('uses only on-scale opacities on the palettes', () => {
    const scale = new Set(Object.keys(config.theme?.opacity ?? {}).length ? Object.keys(config.theme.opacity) : Array.from({ length: 21 }, (_, i) => String(i * 5)))
    const offenders: string[] = []
    for (const f of [...sources('app'), ...sources('components')]) {
      for (const m of read(f).matchAll(/-(?:zombie|tournament|cap|idp)-[a-z]+\/(\d+)\b/g)) if (!scale.has(m[1]!)) offenders.push(`${f}: ${m[0]}`)
    }
    expect(offenders).toEqual([])
  })

  it('leaves the broken form nowhere in app/ or components/', () => {
    const offenders: string[] = []
    for (const f of [...sources('app'), ...sources('components')]) {
      read(f).split('\n').forEach((line, i) => {
        if (BROKEN.test(line)) offenders.push(`${f}:${i + 1}`)
      })
    }
    expect(offenders).toEqual([])
  })
})
