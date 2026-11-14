/**
 * Guillotine on a phone (2026-11-06). Three faults measured at 390px in the e2e harness:
 *
 *  1. The league banner's title touched the card's top border. The guillotine phone rule set `padding:14px`, but
 *     the generic phone rule `.nl-workspace .nl-league-heading{padding-top:0}` has the same specificity and comes
 *     LATER, so it won — correct for the borderless headings it was written for, wrong for a bordered card.
 *  2. Chop-zone names truncated ("Two-Min…") with room to spare in the row: the name got 66px of a 306px row,
 *     because the tier tag (86px) and the points (64px) sat beside it. The tag now sits under the name.
 *  3. Five sub-tabs wrapped onto two rows (391px of buttons in ~338px). One of them, "My Team", only linked to the
 *     workspace's own My team view — which the Section picker directly above already offers — so it is gone, and
 *     the row stays one line (scrolling sideways on a very narrow phone rather than wrapping).
 */
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import React from 'react'
import { render, screen, within } from '@testing-library/react'

vi.mock('@/components/guillotine/GuillotineHome', () => ({ GuillotineHome: () => <div data-testid="gl-home-stub" /> }))

import { GuillotineTab } from '@/app/league/[leagueId]/tabs/GuillotineTab'
import { GuillotineSpecialtyHome } from '@/components/guillotine/GuillotineSpecialtyHome'

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
// 2. Chop-zone names: the tier tag shares the name's column instead of taking width beside it.
// ---------------------------------------------------------------------------------------------------------------

describe('the phone chop-zone list', () => {
  const summary = {
    leagueId: 'L',
    weekOrPeriod: 4,
    myRosterId: 'r07',
    myEscapes: [],
    dangerTiers: [
      { rosterId: 'r01', displayName: 'Blitz Brigade', tier: 'safe', pointsFromChopZone: 22.2 },
      { rosterId: 'r06', displayName: 'The Waiver Hawks', tier: 'danger', pointsFromChopZone: 8.7 },
      { rosterId: 'r07', displayName: 'Gridiron Ghosts', tier: 'danger', pointsFromChopZone: 5.3 },
      { rosterId: 'r09', displayName: 'Two-Minute Drill', tier: 'chop_zone', pointsFromChopZone: 0 },
    ],
  }

  it('puts each tier tag in the same column as the team name, never as a row sibling', () => {
    render(<GuillotineSpecialtyHome leagueId="L" sport="nfl" leagueName="Last Team Standing" summary={summary as never} />)
    const phone = screen.getByTestId('guillotine-phone-home')
    const rows = within(phone).getAllByTestId('guillotine-zone-row')
    expect(rows.length).toBe(3)
    for (const row of rows) {
      const who = within(row).getByTestId('guillotine-zone-who')
      expect(who.parentElement).toBe(row)
      expect(who.textContent).toMatch(/Chop zone|Danger/i)
      // Avatar, the name column, the points — the tag is not a fourth cell competing for width.
      expect(row.children.length).toBe(3)
    }
    expect(within(rows[0]!).getByTestId('guillotine-zone-who').textContent).toContain('Two-Minute Drill')
  })

  it('stacks the tag only in a narrow panel; a tablet-width panel keeps name and tag on one line', () => {
    const css = readFileSync(join(process.cwd(), 'components/guillotine/guillotine-specialty.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const at = css.indexOf('@container (min-width: 420px)')
    const topLevel = at < 0 ? css : css.slice(0, at)
    expect(topLevel).toMatch(/\.who\s*\{[^}]*flex-direction:\s*column/)
    // In a column, a flex-basis is a HEIGHT — the inherited `.name { flex: 0 1 190px }` must be neutralised.
    expect(topLevel).toMatch(/\.who>\.name\s*\{[^}]*flex:\s*none/)
    expect(at, 'no wide-panel container query').toBeGreaterThan(-1)
    expect(css.slice(at)).toMatch(/\.who\s*\{[^}]*flex-direction:\s*row/)
  })
})

// ---------------------------------------------------------------------------------------------------------------
// 3. Sub-tabs: one row, no duplicate of the workspace's My team.
// ---------------------------------------------------------------------------------------------------------------

describe('the Guilly sub-tabs', () => {
  it('drop "My Team", which only linked to the workspace view the Section picker already offers', () => {
    render(<GuillotineTab leagueId="L" sport="NFL" />)
    expect(screen.queryByTestId('guillotine-sub-team')).toBeNull()
    expect(screen.queryByRole('button', { name: /my team/i })).toBeNull()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Hub', 'Waivers', 'History', 'Storylines'])
  })

  it('stay on one line: no wrap, and they scroll sideways if a phone is too narrow', () => {
    render(<GuillotineTab leagueId="L" sport="NFL" />)
    const bar = screen.getByTestId('guillotine-sub-board').parentElement!
    const cls = bar.className.split(/\s+/)
    expect(cls).not.toContain('flex-wrap')
    expect(cls).toContain('flex-nowrap')
    expect(cls).toContain('overflow-x-auto')
    for (const b of screen.getAllByRole('button')) expect(b.className.split(/\s+/)).toContain('shrink-0')
  })
})
