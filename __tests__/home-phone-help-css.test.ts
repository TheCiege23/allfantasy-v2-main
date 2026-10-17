// @vitest-environment node
/**
 * Home page phone fixes from the 2026-10-01 audit, pinned by each rule's place in the parsed CSS.
 *
 * 1. The "?" help popover (`Help` in Dashboard3A.tsx, `[data-help]`) was hidden with
 *    `visibility`, so its 264px body was still laid out: on a 375px phone the weekly-routine badge
 *    put its right edge at 410px and the whole home page scrolled 36px sideways. That control is
 *    gone (2026-10-03): the home's "?" is the shared InfoTip, whose popover opens in the top
 *    layer capped at `min(360px, 100vw - 32px)` — see __tests__/core-app/dashboard-help-tips.test.tsx.
 *    What is pinned here now is that no rule for the retired markup is left behind.
 * 2. Game-day scoring plays were one nowrap line, so the play itself was what got cut on a phone.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss, { type AtRule, type Rule } from 'postcss'
import { describe, expect, it } from 'vitest'

function rules(file: string, selector: string): { media: string; decls: Record<string, string> }[] {
  const css = readFileSync(resolve(__dirname, '../components/core-app', file), 'utf8')
  const out: { media: string; decls: Record<string, string> }[] = []
  postcss.parse(css).walkRules((rule: Rule) => {
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

describe('the retired help popover', () => {
  it('leaves no [data-help] rule behind in the home stylesheet', () => {
    const css = readFileSync(resolve(__dirname, '../components/core-app/af-dash-3a.css'), 'utf8')
    const selectors: string[] = []
    postcss.parse(css).walkRules((rule: Rule) => {
      selectors.push(...rule.selectors)
    })
    expect(selectors.length).toBeGreaterThan(100)
    expect(selectors.filter((s) => s.includes('data-help'))).toEqual([])
  })

  it('the shared InfoTip popover cannot run past a phone screen', () => {
    const pop = rules('af-core.css', '.af-core .af-info-pop').find((r) => r.media === '')?.decls
    expect(pop?.['max-width']).toBe('min(360px, calc(100vw - 32px))')
    expect(pop?.['box-sizing']).toBe('border-box')
  })
})

describe('game-day scoring plays on a phone', () => {
  it('stay one line on a wide screen', () => {
    expect(rules('af-dash-gameday.css', '.af-gd-line').find((r) => r.media === '')?.decls['white-space']).toBe('nowrap')
  })
  it('get two lines at 640px and below', () => {
    expect(rules('af-dash-gameday.css', '.af-gd-line').find((r) => r.media === '(max-width: 640px)')?.decls).toMatchObject({
      'white-space': 'normal',
      '-webkit-line-clamp': '2',
    })
  })
})
