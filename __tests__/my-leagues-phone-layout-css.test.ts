// @vitest-environment node
/**
 * My Leagues on a phone — from the 2026-10-01 sweep of `flex: 1 1 240px` across Core CSS,
 * pinned by each rule's place in the parsed CSS (a rule in the wrong query reads the same to a
 * text search).
 *
 * The list view lays each card out as a wrapping ROW, where `.af-ml-card-top` (1 1 240px) and
 * `.af-ml-card-body` (2 1 260px) are widths. At 720px and below the card becomes a COLUMN and
 * those bases became heights: 602px per list card at 375px, against 208px in grid view. The
 * row's `flex-wrap: wrap`, carried into the column, also sized the top row to its own 436px
 * content inside a 315px card.
 *
 * Separately, the phone grid is `1fr` — `minmax(auto, 1fr)` — so a card's min-content width
 * (the nowrap league name, tile and COMMISH badge) set the track: a 468px column in a 315px
 * grid, and a 498px page on a 375px screen, in both views.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss, { type AtRule, type Rule } from 'postcss'
import { describe, expect, it } from 'vitest'

const CSS = readFileSync(resolve(__dirname, '../components/core-app/af-my-leagues.css'), 'utf8')

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

describe('list view on a phone', () => {
  it('keeps the width bases for the wide row layout', () => {
    expect(rules(".af-ml-card[data-view='list'] .af-ml-card-top").find((r) => r.media === '')?.decls.flex).toBe('1 1 240px')
    expect(rules(".af-ml-card[data-view='list'] .af-ml-card-body").find((r) => r.media === '')?.decls.flex).toBe('2 1 260px')
  })

  it('drops them in the band that turns the card into a column', () => {
    const card = rules(".af-ml-card[data-view='list']").find((r) => r.media === PHONE)?.decls
    expect(card?.['flex-direction']).toBe('column')
    for (const sel of [".af-ml-card[data-view='list'] .af-ml-card-top", ".af-ml-card[data-view='list'] .af-ml-card-body"]) {
      expect(rules(sel).find((r) => r.media === PHONE)?.decls.flex).toBe('0 0 auto')
    }
  })

  it('does not wrap the column, so each line is the card’s width, not its widest item’s', () => {
    expect(rules(".af-ml-card[data-view='list']").find((r) => r.media === PHONE)?.decls['flex-wrap']).toBe('nowrap')
  })
})

describe('a long league name on a phone', () => {
  it('cannot widen the grid track: every card may shrink below its content', () => {
    expect(rules('.af-ml-card').find((r) => r.media === '' && r.decls['min-width'] != null)?.decls['min-width']).toBe('0')
  })
})
