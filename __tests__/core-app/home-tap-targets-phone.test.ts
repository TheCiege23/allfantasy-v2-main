/**
 * Home tap targets on a phone (2026-11-07). Measured live at 375px: injury-card player name 26px, streak
 * chips 40px, "Join a league" 32px, X-feed league chips 28px, "Watch on X" 15px. Each now reaches 44px,
 * and each rule sits in a top-level phone query (CLAUDE.md: a @media opened inside another one silently
 * moves every rule after it into the narrower query).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (p: string) =>
  readFileSync(resolve(process.cwd(), p), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')

/** The brace depth at `index`: 0 means a rule starting there is at the top level of the stylesheet. */
const depthAt = (css: string, index: number) => {
  const before = css.slice(0, index)
  return (before.match(/\{/g) ?? []).length - (before.match(/\}/g) ?? []).length
}

/** The `@media` block that contains `needle`, and that block's own depth. */
const queryAround = (css: string, needle: string) => {
  const at = css.indexOf(needle)
  expect(at, needle).toBeGreaterThan(-1)
  const media = css.lastIndexOf('@media', at)
  return { query: css.slice(media, css.indexOf('{', media)).trim(), depth: depthAt(css, media) }
}

describe('home tap targets reach 44px on a phone', () => {
  it('gives the injury-card player name a 44px hit area without moving its text', () => {
    const css = read('components/core-app/af-dash-triage.css')
    expect(css).toMatch(/\.af-core \.af-triage-name::after \{\s*content: '';\s*position: absolute;\s*inset: -9px -4px;/)
    expect(queryAround(css, '.af-core .af-triage-name::after')).toEqual({ query: '@media (max-width: 640px)', depth: 0 })
  })

  it('lifts the streak chips to 44px with a rule that outranks the 40px one', () => {
    const css = read('components/core-app/home/af-streak.css')
    expect(css).toMatch(/\.af-core a\.af-streak-chip \{\s*min-height: 44px;/)
    expect(queryAround(css, '.af-core a.af-streak-chip')).toEqual({ query: '@media (max-width: 640px)', depth: 0 })
  })

  it('makes "Join a league" a 44px target inside the existing phone block', () => {
    const css = read('components/core-app/af-core-shell.css')
    const needle = '.af-core .af-core-bracket-promo-browse { display: inline-flex;'
    expect(css).toContain(`${needle} align-items: center; min-height: 44px;`)
    expect(queryAround(css, needle)).toEqual({ query: '@media (max-width: 720px)', depth: 0 })
  })

  it('gives the X-feed league chips and "Watch on X" 44px', () => {
    const css = read('components/core-app/highlights/recent-clips.css')
    expect(css).toContain(".af-recent-clips-compact .af-x-badges a::after { content: ''; position: absolute; inset: -4px 0; }")
    expect(css).toContain('.af-recent-clips-compact .af-x-badges a { position: relative; min-height: 36px; }')
    expect(css).toContain('.af-recent-clips-compact .af-x-embed > a { display: inline-flex; align-items: center; min-height: 44px; }')
    expect(queryAround(css, '.af-x-embed > a { display: inline-flex')).toEqual({ query: '@media (max-width: 720px)', depth: 0 })
  })
})
