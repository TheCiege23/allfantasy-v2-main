/**
 * CommishGeneralPanel (app/league/[leagueId]/components/LeagueSettingsSubPanels.tsx) painted
 * fixed-white text on its bg-[#1a1f3a] surfaces; its two labels also failed AA in dark mode
 * (text-white/45 = 4.41:1, text-white/35 = 3.01:1).
 *
 * Mechanism: globals.css flips the CARD to a light surface in light mode (card-premium reads
 * --surface-card; `[class*="bg-[#1a1f3a]"]` is rewritten to --panel2 with no `.mode-readable`
 * scope), but `text-white*` is only rewritten under a `.mode-readable` ancestor. So the text
 * stayed white wherever that ancestor was missing, and coloured text such as `text-cyan-100`
 * is never rewritten at all. The fix uses the theme tokens directly (text-primary,
 * text-secondary, brand-soft / brand-strong, border-subtle), which resolve per mode with no
 * clamp involved. These tests pin those classes.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')

describe('CommishGeneralPanel "Public league" area uses theme tokens', () => {
  const src = read('app/league/[leagueId]/components/LeagueSettingsSubPanels.tsx')
  const start = src.indexOf('function CommishGeneralPanel(')
  const fn = src.slice(start, src.indexOf('\nfunction ', start + 10))
  const classNames = [...fn.matchAll(/^\s*(?:<[a-z]+ )?className="([^"]+)"/gm)].map((m) => m[1])

  it('finds the panel', () => {
    expect(start).toBeGreaterThan(0)
    expect(classNames.length).toBeGreaterThanOrEqual(6)
  })

  it('has no fixed white text anywhere in the panel', () => {
    for (const c of classNames) expect(c).not.toMatch(/(^|\s)text-white(\/\S+)?(\s|$)/)
  })

  it('reads text tokens on the bg-[#1a1f3a] surfaces and their labels', () => {
    const input = classNames.find((c) => c.includes('bg-[#1a1f3a]') && c.includes('text-[13px]'))
    expect(input?.split(/\s+/)).toEqual(expect.arrayContaining(['text-primary', 'border-subtle']))
    expect(fn).toMatch(/<span className="text-\[12px\] text-primary">\{t\('lsPanel\.cg\.public'\)\}/)
    expect(fn).toMatch(/<label className="text-\[11px\] text-secondary">\{t\('lsPanel\.leagueName'\)\}/)
    expect(fn).toMatch(/<p className="mt-1 text-\[11px\] text-secondary">\{t\('lsPanel\.cg\.mirrorNote'\)\}/)
  })
})

describe('the tokens those classes use resolve in every mode', () => {
  const tw = read('tailwind.config.js')
  const css = read('app/globals.css')

  it('maps the utilities onto the semantic tokens', () => {
    expect(tw).toMatch(/primary: 'var\(--text-primary\)'/)
    expect(tw).toMatch(/secondary: 'var\(--text-secondary\)'/)
    expect(tw).toMatch(/subtle: 'var\(--border-subtle\)'/)
    expect(tw).toMatch(/soft: 'var\(--color-primary-soft\)'/)
    expect(tw).toMatch(/strong: 'var\(--color-primary-strong\)'/)
  })

  it('defines those tokens for light (:root), dark and legacy', () => {
    for (const block of [/:root \{[\s\S]*?\n\}/, /html\[data-mode="dark"\] \{[\s\S]*?\n\}/, /html\[data-mode="legacy"\] \{[\s\S]*?\n\}/]) {
      const body = css.match(block)?.[0] ?? ''
      for (const token of ['--text-primary:', '--text-secondary:', '--border-subtle:', '--color-primary-soft:', '--color-primary-strong:']) {
        expect(body, `${block} ${token}`).toContain(token)
      }
    }
  })
})
