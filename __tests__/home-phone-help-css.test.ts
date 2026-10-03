// @vitest-environment node
/**
 * Home page phone fixes from the 2026-10-01 audit, pinned by each rule's place in the parsed CSS.
 *
 * 1. The "?" help popover (`Help` in Dashboard3A.tsx, `[data-help]`) was hidden with
 *    `visibility`, so its 264px body was still laid out: on a 375px phone the weekly-routine badge
 *    put its right edge at 410px and the whole home page scrolled 36px sideways. It is
 *    `display: none` until opened now, opens on a TAP (`:focus` — a tap does not match
 *    `:focus-visible`), and on a phone opens as a full-width card above the fixed tab bar.
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

describe('the help popover', () => {
  it('is not laid out at all while closed, so it cannot widen the page', () => {
    const base = rules('af-dash-3a.css', '[data-help-body]').find((r) => r.media === '' && r.decls.position === 'absolute')
    expect(base?.decls.display).toBe('none')
  })

  it('opens on hover, on keyboard focus, and on a tap', () => {
    for (const sel of ['[data-help]:hover [data-help-body]', '[data-help]:focus [data-help-body]', '[data-help]:focus-visible [data-help-body]']) {
      expect(rules('af-dash-3a.css', sel).find((r) => r.media === '')?.decls.display).toBe('block')
    }
  })

  it('on a phone, opens as a full-width card above the fixed tab bar', () => {
    const phone = rules('af-dash-3a.css', '[data-help-body]').find((r) => r.media === '(max-width: 560px)')?.decls
    expect(phone).toMatchObject({ position: 'fixed', left: '16px', right: '16px', width: 'auto' })
    expect(phone?.bottom).toContain('--af-tabbar-height')
    // Above the tab bar (40) and the league chat bar (39).
    expect(Number(phone?.['z-index'])).toBeGreaterThan(40)
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
