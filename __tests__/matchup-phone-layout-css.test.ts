// @vitest-environment node
/**
 * Two Matchup layout bugs measured on a 375px phone (2026-10-01 audit), pinned by each rule's
 * place in the parsed CSS — a rule in the wrong query reads the same to a text search.
 *
 * 1. "What decides it": `flex: 1 1 240px` is a WIDTH while the item is a row, and became a 240px
 *    HEIGHT when the 780px band turns the item into a column — 261px per one-line item.
 * 2. The provider button names the league ("View Matchup in <league>"). Its `truncate` span
 *    clips the name with an ellipsis, but a flex item's minimum width is its min-content width —
 *    the whole name — so in the phone league-first layout the button grew to 463px in a 343px
 *    row and the page scrolled sideways. `min-width: 0` is the fix; measured with Tailwind's real
 *    `.truncate` applied, since a render without it shows the label spilling instead.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss, { type AtRule, type Rule } from 'postcss'
import { describe, expect, it } from 'vitest'

const CSS = readFileSync(resolve(__dirname, '../components/core-app/af-matchup.css'), 'utf8')

function rules(selector: string): { media: string; decls: Record<string, string> }[] {
  const out: { media: string; decls: Record<string, string> }[] = []
  postcss.parse(CSS).walkRules((rule: Rule) => {
    if (!rule.selectors.includes(selector)) return
    const media: string[] = []
    for (let p = rule.parent; p && p.type !== 'root'; p = p.parent) media.push((p as AtRule).params)
    const decls: Record<string, string> = {}
    rule.walkDecls((d) => {
      decls[d.prop] = d.value
    })
    out.push({ media: media.join(' / '), decls })
  })
  return out
}

describe('"What decides it" on a phone', () => {
  it('keeps the 240px basis for the wide row layout', () => {
    expect(rules('.af-mu-missing-why').find((r) => r.media === '')?.decls.flex).toBe('1 1 240px')
  })

  it('drops it in the same band that turns the item into a column', () => {
    const column = rules('.af-mu-missing li').find((r) => r.media === '(max-width: 780px)')
    expect(column?.decls['flex-direction']).toBe('column')
    for (const sel of ['.af-mu-missing-why', '.af-mu-missing-value']) {
      expect(rules(sel).find((r) => r.media === '(max-width: 780px)')?.decls.flex).toBe('0 0 auto')
    }
  })
})

describe('the provider button with a long league name', () => {
  it('can shrink below the width of its label at every width, so the ellipsis applies', () => {
    const btn = rules('.af-core .af-btn.af-mu-source').find((r) => r.media === '')
    expect(btn?.decls['min-width']).toBe('0')
  })
})
