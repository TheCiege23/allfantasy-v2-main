// @vitest-environment node
/**
 * The landing nav on tablets. Measured 2026-09-29: from 721px (where the hamburger stops) to
 * ~980px (~1100px in Spanish) the full nav did not fit on one row, wrapped, and — because the bar
 * had a fixed 74px height — hung its second row under the launch banner. On every iPad in portrait
 * a tap on Sign in or "Get started free" landed on the banner instead.
 *
 * A stylesheet cannot be laid out in a unit test, so this pins the two rules that fixed it, by
 * where they sit in the parsed CSS (not by grepping text: a rule inside the wrong @media block reads
 * the same to grep and means something else — see CLAUDE.md on af-matchup.css).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss, { type AtRule, type Rule } from 'postcss'
import { describe, expect, it } from 'vitest'

const CSS = readFileSync(resolve(__dirname, '../components/core-app/af-landing.css'), 'utf8')

function rulesFor(selector: string): { media: string[]; decls: Record<string, string> }[] {
  const out: { media: string[]; decls: Record<string, string> }[] = []
  postcss.parse(CSS).walkRules((rule: Rule) => {
    if (rule.selector !== selector) return
    const media: string[] = []
    for (let p = rule.parent; p && p.type !== 'root'; p = p.parent) media.push((p as AtRule).params)
    const decls: Record<string, string> = {}
    rule.walkDecls((d) => {
      decls[d.prop] = d.value
    })
    out.push({ media, decls })
  })
  return out
}

describe('landing nav on tablets', () => {
  it('hides the three text links from 721px up to the width where the full nav fits (1099px)', () => {
    const hidden = rulesFor('.af-lp-nav-links').filter((r) => r.decls.display === 'none')
    // One band for tablets — the phone block hides them too, which is the other entry.
    expect(hidden.map((r) => r.media)).toContainEqual(['(min-width: 721px) and (max-width: 1099px)'])
  })

  it('lets the bar grow above 720px instead of overflowing a fixed height', () => {
    const tablet = rulesFor('.af-lp-nav').find((r) => r.media.join() === '(min-width: 721px)')
    expect(tablet?.decls).toMatchObject({ height: 'auto', 'min-height': '74px' })
  })

  it('uses a fixed compact bar through 1100px without a conflicting base min-height', () => {
    const compact = rulesFor('.af-lp-nav').find((r) => r.media.join() === '(max-width: 1100px)')
    expect(compact?.decls.height).toBe('64px')
    const base = rulesFor('.af-lp-nav').find((r) => r.media.length === 0)
    expect(base?.decls['min-height']).toBeUndefined()
  })
})
