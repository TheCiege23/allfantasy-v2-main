/**
 * The dynasty league banner on a phone (2026-11-06). Measured at 390px in the redraft-league harness with
 * format=dynasty: the banner paints an art-backed card (`.nl-workspace[data-dynasty-background=true]
 * .nl-league-heading`) but its padding came from the generic phone rules — `.nl-league-heading{padding:10px 0 0}`
 * and `.nl-workspace .nl-league-heading{padding-top:0}` — which are right for the transparent redraft heading and
 * left this card's title 0px from its top edge and its avatar flush against its left edge.
 *
 * A small cascade over the real stylesheet: collect every rule that applies at 390px and matches the heading, then
 * take the winner per side by specificity and source order. Redraft is the control and must not move.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CSS = readFileSync(join(process.cwd(), 'components/league/native/native-league.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

type Rule = { selector: string; body: string; order: number }
/** Top-level rules plus those inside `@media(max-width:767px)` blocks (no min-width), in source order. */
function phoneRules(css: string): Rule[] {
  const out: Rule[] = []
  let order = 0
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
      if (prelude.startsWith('@media')) walk(body, keep && /max-width:\s*767px/.test(prelude) && !/min-width/.test(prelude))
      else if (!prelude.startsWith('@') && keep) for (const s of prelude.split(',')) out.push({ selector: s.trim(), body, order: order++ })
      j = close + 1
    }
  }
  walk(css, true)
  return out
}

type El = { classes: string[]; attrs: Record<string, string> }
function compound(sel: string, el: El): boolean {
  if (/[:>+~*#]/.test(sel) || /^[a-z]/i.test(sel)) return false
  const classes = [...sel.matchAll(/\.([\w-]+)/g)].map((m) => m[1]!)
  const attrs = [...sel.matchAll(/\[([\w-]+)(?:=['"]?([^'"\]]+)['"]?)?\]/g)]
  return classes.every((c) => el.classes.includes(c)) && attrs.every(([, k, v]) => (v == null ? k! in el.attrs : el.attrs[k!] === v))
}
const HEADING: El = { classes: ['nl-league-heading'], attrs: {} }
function matches(selector: string, workspace: El): boolean {
  const parts = selector.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return compound(parts[0]!, HEADING)
  if (parts.length === 2) return compound(parts[0]!, workspace) && compound(parts[1]!, HEADING)
  return false
}
const specificity = (s: string) => (s.match(/\.[\w-]+|\[[^\]]+\]/g) ?? []).length

/** Expand `padding` shorthand / longhands into the side asked for. */
function side(body: string, which: 'top' | 'left'): string | null {
  let v: string | null = null
  for (const d of body.split(';')) {
    const [k, ...rest] = d.split(':')
    const key = k?.trim()
    const val = rest.join(':').trim()
    if (key === 'padding') {
      const p = val.split(/\s+/)
      v = which === 'top' ? p[0]! : (p[3] ?? p[1] ?? p[0])!
    }
    if (key === `padding-${which}`) v = val
  }
  return v
}
function winner(workspace: El, which: 'top' | 'left') {
  const hits = phoneRules(CSS)
    .filter((r) => matches(r.selector, workspace) && side(r.body, which) != null)
    .sort((a, b) => specificity(a.selector) - specificity(b.selector) || a.order - b.order)
  const w = hits[hits.length - 1]!
  return { selector: w.selector, px: Number.parseFloat(side(w.body, which)!) }
}

const DYNASTY: El = { classes: ['af-core', 'nl-workspace'], attrs: { 'data-dynasty-background': 'true' } }
const REDRAFT: El = { classes: ['af-core', 'nl-workspace'], attrs: { 'data-format': 'redraft' } }

describe('the dynasty banner on a phone', () => {
  it.each(['top', 'left'] as const)('keeps %s padding inside its card', (which) => {
    const w = winner(DYNASTY, which)
    expect(w.selector, `winning rule: ${w.selector}`).toContain('[data-dynasty-background=true]')
    expect(w.px).toBeGreaterThanOrEqual(12)
  })

  it('control: the transparent redraft heading keeps its flush phone padding', () => {
    expect(winner(REDRAFT, 'top').px).toBe(0)
    expect(winner(REDRAFT, 'left').px).toBe(0)
  })
})
