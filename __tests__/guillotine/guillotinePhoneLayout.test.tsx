/**
 * Guillotine on a phone (2026-11-06). Three faults measured at 390px in the e2e harness:
 *
 *  1. The league banner's title touched the card's top border. The guillotine phone rule set `padding:14px`, but
 *     the generic phone rule `.nl-workspace .nl-league-heading{padding-top:0}` has the same specificity and comes
 *     LATER, so it won — correct for the borderless headings it was written for, wrong for a bordered card.
 *  2. Chop-zone names truncated in the hub's phone-only list. That list is gone with the hub (2026-11-25): a phone
 *     shows the same one list a desktop does (components/guillotine/GuillySurvivalBoard.tsx).
 *  3. Five sub-tabs wrapped onto two rows. The row is gone too (2026-11-25, "too many tabs"): three of its four
 *     buttons only scrolled the same page, and Waivers is the Team tab's own screen.
 */
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import React from 'react'
import { render, screen } from '@testing-library/react'

vi.mock('@/components/guillotine/GuillotineHome', () => ({ GuillotineHome: () => <div data-testid="gl-home-stub" /> }))

import { GuillotineTab } from '@/app/league/[leagueId]/tabs/GuillotineTab'

// ---------------------------------------------------------------------------------------------------------------
// 1. The banner, by a small cascade over the real stylesheet.
// ---------------------------------------------------------------------------------------------------------------

const NATIVE_CSS = readFileSync(join(process.cwd(), 'components/league/native/native-league.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

type Rule = { selector: string; body: string; order: number }
/** Top-level rules plus the rules inside every `@media(max-width:767px)` block, in source order. */
function phoneRules(css: string): Rule[] {
  const out: Rule[] = []
  let order = 0
  /** `keep` is false only inside a media block that does not apply at 390px. */
  const walk = (text: string, keep: boolean) => {
    let j = 0
    while (j < text.length) {
      const open = text.indexOf('{', j)
      if (open < 0) break
      const prelude = text.slice(j, open).trim()
      let depth = 0
      let close = open
      for (let k = open; k < text.length; k++) {
        if (text[k] === '{') depth++
        else if (text[k] === '}' && --depth === 0) { close = k; break }
      }
      const body = text.slice(open + 1, close)
      if (prelude.startsWith('@media')) {
        walk(body, keep && /max-width:\s*767px/.test(prelude) && !/min-width/.test(prelude))
      } else if (!prelude.startsWith('@') && keep) {
        for (const s of prelude.split(',')) out.push({ selector: s.trim(), body, order: order++ })
      }
      j = close + 1
    }
  }
  walk(css, true)
  return out
}

type El = { classes: string[]; attrs: Record<string, string> }
const WORKSPACE: El = { classes: ['af-core', 'nl-workspace'], attrs: { 'data-format': 'guillotine', 'data-guillotine-mood': 'calm' } }
const HEADING: El = { classes: ['nl-league-heading'], attrs: { 'data-format': 'guillotine' } }

/** Matches a compound selector (classes + [attr=value]) against one element; anything fancier is "no match". */
function compound(sel: string, el: El): boolean {
  if (/[:>+~*#]/.test(sel) || /^[a-z]/i.test(sel)) return false
  const classes = [...sel.matchAll(/\.([\w-]+)/g)].map((m) => m[1]!)
  const attrs = [...sel.matchAll(/\[([\w-]+)(?:=['"]?([^'"\]]+)['"]?)?\]/g)]
  return classes.every((c) => el.classes.includes(c)) && attrs.every(([, k, v]) => (v == null ? k! in el.attrs : el.attrs[k!] === v))
}
function matchesHeading(selector: string): boolean {
  const parts = selector.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return compound(parts[0]!, HEADING)
  if (parts.length === 2) return compound(parts[0]!, WORKSPACE) && compound(parts[1]!, HEADING)
  return false
}
const specificity = (s: string) => (s.match(/\.[\w-]+|\[[^\]]+\]/g) ?? []).length
function paddingTop(body: string): string | null {
  let v: string | null = null
  for (const d of body.split(';')) {
    const [k, ...rest] = d.split(':')
    const key = k?.trim()
    const val = rest.join(':').trim()
    if (key === 'padding') v = val.split(/\s+/)[0]!
    if (key === 'padding-top') v = val
  }
  return v
}

describe('the guillotine banner on a phone', () => {
  it('keeps its top padding, so the title does not touch the card border', () => {
    const winners = phoneRules(NATIVE_CSS)
      .filter((r) => matchesHeading(r.selector) && paddingTop(r.body) != null)
      .sort((a, b) => specificity(a.selector) - specificity(b.selector) || a.order - b.order)
    expect(winners.length, 'no phone padding rule reaches the heading').toBeGreaterThan(0)
    const win = winners[winners.length - 1]!
    expect(win.selector, `winning rule: ${win.selector}`).toContain('[data-format=guillotine]')
    expect(Number.parseFloat(paddingTop(win.body)!)).toBeGreaterThanOrEqual(12)
  })

  it('the cascade check can fail: the generic phone rule alone zeroes it', () => {
    const generic = phoneRules(NATIVE_CSS).filter((r) => r.selector === '.nl-workspace .nl-league-heading' && /padding-top:0/.test(r.body))
    expect(generic.length).toBe(1)
    expect(matchesHeading(generic[0]!.selector)).toBe(true)
  })
})

// ---------------------------------------------------------------------------------------------------------------
// 2 and 3. One page, no sub-tab row.
// ---------------------------------------------------------------------------------------------------------------

describe('the Chop tab', () => {
  it('🛑 has no sub-tab row: it is the page, nothing else', () => {
    render(<GuillotineTab leagueId="L" sport="NFL" />)
    expect(screen.getByTestId('gl-home-stub')).toBeTruthy()
    expect(screen.queryAllByRole('button')).toEqual([])
    for (const id of ['board', 'waivers', 'history', 'storylines', 'team']) expect(screen.queryByTestId(`guillotine-sub-${id}`), id).toBeNull()
  })

  it('the board that replaced the phone list keeps one grid on a phone: rank, avatar, name, points', () => {
    const css = readFileSync(join(process.cwd(), 'components/guillotine/guilly-survival-board.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const phone = css.slice(css.indexOf('@media (max-width: 560px)'))
    expect(phone).toMatch(/\.gsb-row\s*\{[^}]*grid-template-columns:\s*20px 30px minmax\(0, 1fr\) auto/)
    // The name column can shrink, so a long team name truncates instead of pushing the points off the row.
    expect(css).toMatch(/\.gsb-name\s*\{[^}]*min-width:\s*0/)
  })
})
