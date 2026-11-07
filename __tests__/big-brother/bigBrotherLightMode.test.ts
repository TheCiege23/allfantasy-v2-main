/**
 * Big Brother sub-views in light mode (2026-11-07, Big Brother audit item 2). The sub-views are written dark-only —
 * navy gradient panels, `text-white`, pale accent text — and in light mode the global readability clamp turned the
 * text dark while leaving most of the navy panels dark: measured at 820px, 21 of 22 text elements on Voting sat below
 * 3:1 contrast. `components/big-brother/big-brother-light.css` repaints them for Big Brother only.
 *
 * The CSS works by Tailwind class SUBSTRING, so the risk is drift: a new navy hex or accent hue that the substrings
 * do not cover silently comes back dark-on-dark. The census below reads every Big Brother component and fails on one.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(process.cwd(), 'components/big-brother')
const CSS_PATH = join(DIR, 'big-brother-light.css')
const read = (p: string) => readFileSync(p, 'utf8')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '')

let css = ''
try {
  css = strip(read(CSS_PATH))
} catch {
  css = ''
}
const home = read(join(DIR, 'BigBrotherHome.tsx'))
const command = read(join(DIR, 'BigBrotherCommandDashboard.tsx'))
const sources = readdirSync(DIR)
  .filter((f) => f.endsWith('.tsx') && !f.startsWith('BigBrotherSpecialtyHome'))
  .map((f) => read(join(DIR, f)))
  .join('\n')

const SCOPE = "html[data-mode='light'] .af-bb-shell"

function rules(text: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) out.push({ selector: m[1].trim(), body: m[2] })
  return out
}

describe('Big Brother light-mode stylesheet', () => {
  it('exists and is loaded by BigBrotherHome, whose root carries the scope', () => {
    expect(css.length, 'components/big-brother/big-brother-light.css is missing').toBeGreaterThan(0)
    expect(home).toMatch(/import '\.\/big-brother-light\.css'/)
    expect(home).toMatch(/className="[^"]*\baf-bb-shell\b/)
    expect(home).toMatch(/data-bb-view=\{view\}/)
  })

  it('the Command dashboard, a separate page, carries the same scope', () => {
    expect(command).toMatch(/import '\.\/big-brother-light\.css'/)
    expect(command).toMatch(/className="[^"]*\baf-bb-shell\b/)
  })

  it('every rule is light-mode only and Big Brother only', () => {
    const rs = rules(css)
    expect(rs.length).toBeGreaterThan(5)
    for (const r of rs) {
      for (const sel of r.selector.split(/,(?![^(]*\))/)) expect(sel.trim().startsWith(SCOPE), sel).toBe(true)
    }
  })

  it('uses tokens for every colour', () => {
    for (const r of rules(css)) {
      for (const decl of r.body.split(';')) {
        const [prop, ...v] = decl.split(':')
        const value = v.join(':').replace('!important', '').trim()
        if (!/color|background|border-color/.test(prop ?? '') || !value) continue
        if (value === 'none') continue
        // A token, or a color-mix of tokens — never a literal.
        expect(value, `${r.selector} { ${decl.trim()} }`).toMatch(/^(var\(--[a-z0-9-]+\)|color-mix\(in srgb, var\(--[a-z0-9-]+\) \d+%, var\(--[a-z0-9-]+\)\))$/)
      }
    }
  })
})

describe('census: everything the Big Brother components paint is covered', () => {
  it('every dark hex surface starts #0/#1, which the panel rules match', () => {
    const dark = new Set<string>()
    for (const m of sources.matchAll(/\b(?:bg|from|via|to)-\[#([0-9a-fA-F]{6})\]/g)) {
      const hex = m[1]
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      if (0.2126 * r + 0.7152 * g + 0.0722 * b < 0.15) dark.add(hex.toLowerCase())
    }
    expect(dark.size).toBeGreaterThan(0)
    const uncovered = [...dark].filter((h) => !/^[01]/.test(h))
    expect(uncovered, 'dark surfaces the light rules do not match').toEqual([])
    for (const pre of ['bg-[#0', 'bg-[#1', 'from-[#0', 'from-[#1', 'via-[#0', 'to-[#0', 'to-[#1']) expect(css).toContain(`[class*='${pre}']`)
  })

  it('every pale accent hue has a token mapping', () => {
    const hues = new Set<string>()
    for (const m of sources.matchAll(/\btext-([a-z]+)-([1-4]00)\b/g)) if (!['white', 'black', 'gray', 'slate', 'zinc', 'neutral', 'stone'].includes(m[1])) hues.add(m[1])
    expect(hues.size).toBeGreaterThan(3)
    const missing = [...hues].filter((h) => !css.includes(`[class*='text-${h}-']`))
    expect(missing, 'accent hues with no light-mode colour').toEqual([])
  })

  it('every dark tinted fill (900/950) has a soft-token mapping', () => {
    const hues = new Set<string>()
    for (const m of sources.matchAll(/\b(bg|from)-([a-z]+)-9[05]0\b/g)) if (!['gray', 'slate', 'zinc', 'neutral', 'stone', 'black'].includes(m[2])) hues.add(`${m[1]}-${m[2]}`)
    const missing = [...hues].filter((h) => !css.includes(`[class*='${h}-9']`))
    expect(missing, 'dark tints with no light-mode surface').toEqual([])
  })
})
