// @vitest-environment node
/**
 * On a phone a board's section label must be able to wrap. Measured 2026-09-29 on the App Review
 * account at 390px: /core/trades' "TOP 3 · RANKED BY DEADLINE · NO TRADES ON FILE IN ANY OF THEM"
 * is 395px of `nowrap` text in a 366px line, so the whole page scrolled sideways (407px). Wrapping
 * the head row alone could not help — the label was longer than a line on its own.
 *
 * Pinned by the rule's place in the parsed CSS: a rule outside the phone query would let the
 * labels wrap on desktop too, and a rule inside the wrong query reads the same to a text search.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss, { type AtRule, type Rule } from 'postcss'
import { describe, expect, it } from 'vitest'

const CSS = readFileSync(resolve(__dirname, '../components/core-app/af-core-boards.css'), 'utf8')

function rules(selector: string): { media: string; decls: Record<string, string> }[] {
  const out: { media: string; decls: Record<string, string> }[] = []
  postcss.parse(CSS).walkRules((rule: Rule) => {
    if (rule.selector !== selector) return
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

describe('board section labels on a phone', () => {
  it('stay on one line on desktop', () => {
    const base = rules('.af-core .af-bd-sec-label').find((r) => r.media === '')
    expect(base?.decls['white-space']).toBe('nowrap')
  })

  it('wrap inside themselves at 720px and below', () => {
    const phone = rules('.af-core .af-bd-sec-label').find((r) => r.media === '(max-width: 720px)')
    expect(phone?.decls).toMatchObject({ 'white-space': 'normal', 'min-width': '0' })
  })
})
