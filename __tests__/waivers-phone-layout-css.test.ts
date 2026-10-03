// @vitest-environment node
/**
 * Waivers phone fixes from the 2026-10-01 audit, pinned by each rule's place in the parsed CSS —
 * a rule in the wrong query reads the same to a text search.
 *
 * 1. "How waivers run here": `flex: 1 1 240px` is a WIDTH in the row and became a 240px HEIGHT
 *    when the 720px band turns each rule into a column — 261px per one-line rule on a phone.
 * 2. The four header tiles: `minmax(190px, 1fr)` fit one column in a 343px row; two by two now.
 * 3. The all-leagues board: Add and Drop side by side on a phone — for Waivers ONLY. Trades and
 *    Draft HQ share the swap layout and keep their stack, so every rule must carry `--waivers`.
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
  it('sit two by two at 560px and below', () => {
    expect(rules('af-waivers.css', '.af-wv-tiles').find((r) => r.media === '(max-width: 560px)')?.decls['grid-template-columns']).toBe(
      'repeat(2, minmax(0, 1fr))',
    )
  })
})

describe('the all-leagues board on a phone', () => {
  it('puts Add and Drop side by side for Waivers', () => {
    const sel = '.af-core .af-bd-cards--rich.af-bd-cards--waivers .af-bd-swap'
    expect(rules('af-core-boards.css', sel).find((r) => r.media === '(max-width: 720px)')?.decls['grid-template-columns']).toBe(
      'minmax(0, 1fr) minmax(0, 1fr)',
    )
  })
  it('🛑 changes nothing for the boards that share the swap: no unscoped phone rule goes two-column', () => {
    // Every rule in the phone band that lays out the swap grid: unscoped ones must keep the shared
    // single-column stack Trades and Draft HQ rely on; only a `--waivers` rule may go side by side.
    const swapGrids: { selector: string; cols: string }[] = []
    parse('af-core-boards.css').walkRules((rule: Rule) => {
      const inPhoneBand = rule.parent?.type === 'atrule' && (rule.parent as AtRule).params === '(max-width: 720px)'
      if (!inPhoneBand || !/\.af-bd-swap$/.test(rule.selector)) return
      rule.walkDecls('grid-template-columns', (d) => swapGrids.push({ selector: rule.selector, cols: d.value }))
    })
    const unscoped = swapGrids.filter((g) => !g.selector.includes('--waivers'))
    expect(unscoped.length).toBeGreaterThan(0)
    for (const g of unscoped) expect(g.cols).toBe('minmax(0, 1fr)')
    expect(swapGrids.some((g) => g.selector.includes('--waivers') && g.cols === 'minmax(0, 1fr) minmax(0, 1fr)')).toBe(true)
  })
})
