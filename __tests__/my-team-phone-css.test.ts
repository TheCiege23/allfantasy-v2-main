// @vitest-environment node
/**
 * My Team layout fixes from the 2026-10-01 phone audit, pinned by each rule's place in the
 * parsed CSS — a rule in the wrong query reads the same to a text search.
 *
 * 1. The opponent card: the wrapper around the team name had no `min-width: 0`, so the name's
 *    full nowrap width set the minimum and it painted 59px across the projected total.
 * 2. The projection tiles: on a phone one explanatory sentence in a 92px column made all three
 *    tiles 205px tall. It takes its own full-width row at 560px and below.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss, { type AtRule, type Rule } from 'postcss'
import { describe, expect, it } from 'vitest'

const CSS = readFileSync(resolve(__dirname, '../components/core-app/af-my-team.css'), 'utf8')

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

describe('the opponent card', () => {
  it('lets the name wrapper shrink at every width', () => {
    expect(rules('.af-mt-mu-who > div').find((r) => r.media === '')?.decls['min-width']).toBe('0')
  })
  it('gives the name two lines where the card is narrow', () => {
    expect(rules('.af-mt-mu-name').find((r) => r.media === '(max-width: 860px)')?.decls['white-space']).toBe('normal')
  })
})

describe('the projection tiles on a phone', () => {
  it('moves the standard tile’s explanation onto its own full-width row', () => {
    expect(rules('.af-mt-projgroup').find((r) => r.media === '(max-width: 560px)')?.decls['flex-wrap']).toBe('wrap')
    expect(
      rules(".af-mt-projgroup > .af-mt-tile--proj[data-missing='true']").find((r) => r.media === '(max-width: 560px)')?.decls.flex,
    ).toBe('1 0 100%')
  })
  it('keeps the two totals side by side on the first row', () => {
    expect(rules('.af-mt-projgroup > .af-mt-tile--af').find((r) => r.media === '(max-width: 560px)')?.decls).toMatchObject({
      flex: '1 1 0',
      'min-width': '0',
    })
  })
})
