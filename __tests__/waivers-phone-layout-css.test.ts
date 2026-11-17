// @vitest-environment node
/**
 * Waivers phone fixes from the 2026-10-01 audit, pinned by each rule's place in the parsed CSS —
 * a rule in the wrong query reads the same to a text search.
 *
 * 1. "How waivers run here": `flex: 1 1 240px` is a WIDTH in the row and became a 240px HEIGHT
 *    when the 720px band turns each rule into a column — 261px per one-line rule on a phone.
 * 2. The four header tiles: `minmax(190px, 1fr)` fit one column in a 343px row; two by two now —
 *    since 2026-11 from the shared StatStrip (primitives/af-primitives.css).
 * (3. The all-leagues board's Add/Drop phone layout went with that board, 2026-11-12.)
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss, { type AtRule, type Rule } from 'postcss'
import { describe, expect, it } from 'vitest'

function parse(file: string) {
  return postcss.parse(readFileSync(resolve(__dirname, '../components/core-app', file), 'utf8'))
}
function rules(file: string, selector: string): { media: string; decls: Record<string, string> }[] {
  const out: { media: string; decls: Record<string, string> }[] = []
  parse(file).walkRules((rule: Rule) => {
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

describe('"How waivers run here" on a phone', () => {
  it('keeps the 240px basis for the wide row layout', () => {
    expect(rules('af-waivers.css', '.af-wv-rule-why').find((r) => r.media === '')?.decls.flex).toBe('1 1 240px')
  })
  it('drops it in the same band that turns each rule into a column', () => {
    expect(rules('af-waivers.css', '.af-wv-rules li').find((r) => r.media === '(max-width: 720px)')?.decls['flex-direction']).toBe('column')
    for (const sel of ['.af-wv-rule-why', '.af-wv-rule-value']) {
      expect(rules('af-waivers.css', sel).find((r) => r.media === '(max-width: 720px)')?.decls.flex).toBe('0 0 auto')
    }
  })
})

describe('the header tiles on a phone', () => {
  // The tiles are the shared StatStrip now (2026-11): its phone layout is the base rule, two by two.
  it('sit two by two at phone width, from the shared strip', () => {
    expect(rules('primitives/af-primitives.css', '.af-core .af-pg-stats').find((r) => r.media === '')?.decls['grid-template-columns']).toBe(
      'repeat(2, minmax(0, 1fr))',
    )
  })
  it('and Waivers no longer lays its own tiles out', () => {
    expect(rules('af-waivers.css', '.af-wv-tiles')).toEqual([])
  })
})

/* The all-leagues board's Add/Drop phone layout went with that board (removed 2026-11-12). */
