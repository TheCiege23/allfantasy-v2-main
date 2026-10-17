// @vitest-environment node
/**
 * Trade Center phone fixes from the 2026-10-01 audit, pinned by each rule's place in the parsed
 * CSS — a rule in the wrong query reads the same to a text search.
 *
 * 1. The builder is one `1fr` (= `minmax(auto, 1fr)`) column on a phone, so a long picked row
 *    set the side panel's minimum: 380px panel, 396px page on a 375px screen ("what you get").
 * 2. The phone context row is a non-wrapping scroller whose name could SHRINK, so the deadline
 *    chip squeezed the league name to 74px and six lines. It wraps on a phone now.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss, { type AtRule, type Rule } from 'postcss'
import { describe, expect, it } from 'vitest'

const CSS = readFileSync(resolve(__dirname, '../components/core-app/af-trade-center.css'), 'utf8')

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
const PHONE = '(max-width: 720px)'
/** The LAST rule for a selector in a band — what the cascade applies within one file. */
const last = (selector: string, media: string) => rules(selector).filter((r) => r.media === media).at(-1)?.decls

describe('the trade builder on a phone', () => {
  it('lets each side panel shrink to the screen, whatever a picked row measures', () => {
    expect(last('.af-tc-builder > .af-tc-team', '')?.['min-width']).toBe('0')
  })
})

describe('the league context row on a phone', () => {
  it('wraps, so the deadline moves to its own line instead of squeezing the name', () => {
    expect(last('.af-tc-context', PHONE)).toMatchObject({ 'flex-wrap': 'wrap', 'overflow-x': 'visible' })
  })
  it('gives the name the room on its line', () => {
    expect(last('.af-tc-context .af-tc-context-name', PHONE)).toMatchObject({ flex: '1 1 200px', 'min-width': '0' })
  })
})
