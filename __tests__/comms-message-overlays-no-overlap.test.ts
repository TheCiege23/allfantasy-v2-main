import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * V3 (hands-on chat test, 2026-09-25): the "Latest" jump pill and the desktop hover toolbar covered
 * message text and reactions in the thread view.
 *
 * Measured in Chromium against the real ChatMessageList (see the commit message for the harness):
 *   pill     — before: overlapped content at 81 of 138 scroll positions on a 390x844 phone,
 *              58 of 138 at 1280x800. After: 0 of 148 / 0 of 152.
 *   toolbar  — before: covered its own bubble on 15 of 15 hovered rows at 1280x800. After: 0 of 16.
 *
 * jsdom has no layout, so this pins the RULES that produce that geometry — and pins which block
 * each one lives in, because a rule that drifts into the wrong @media or @container is valid CSS
 * that silently means something else (CLAUDE.md, "CSS has its own member of this family").
 */

const CSS = readFileSync(path.join(process.cwd(), 'components/core-app/af-comms.css'), 'utf8')

type Rule = { selector: string; body: string; context: string[] }

/** Every style rule, with the at-rule preludes it sits inside. Comments are stripped first. */
function rules(source: string): Rule[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: Rule[] = []
  const stack: string[] = []
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '{') {
      const prelude = text.slice(start, i).trim()
      if (prelude.startsWith('@')) {
        stack.push(prelude)
        start = i + 1
      } else {
        const end = text.indexOf('}', i)
        out.push({ selector: prelude, body: text.slice(i + 1, end), context: [...stack] })
        i = end
        start = end + 1
      }
    } else if (c === '}') {
      stack.pop()
      start = i + 1
    }
  }
  return out
}

const ALL = rules(CSS)
const find = (selector: string) => ALL.filter((r) => r.selector.split(',').map((s) => s.trim()).includes(selector))
const decl = (r: Rule, prop: string) => {
  const m = r.body.match(new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`))
  return m ? m[1].trim() : null
}

describe('the jump pill sits in the flow, above the composer, never over a message', () => {
  const jump = find('.af-cm-jump')

  it('is not absolutely positioned anywhere', () => {
    expect(jump.length).toBeGreaterThan(0)
    for (const r of jump) expect(decl(r, 'position')).not.toBe('absolute')
    for (const r of jump) {
      expect(decl(r, 'bottom')).toBeNull()
      expect(decl(r, 'right')).toBeNull()
    }
  })

  it('takes its own space at the end of the list (flex: none, aligned right, with room below)', () => {
    const base = jump.find((r) => r.context.length === 0)!
    expect(base).toBeTruthy()
    expect(decl(base, 'flex')).toBe('none')
    expect(decl(base, 'align-self')).toBe('flex-end')
    const margin = decl(base, 'margin')!.split(/\s+/)
    expect(Number.parseInt(margin[2] ?? margin[0], 10)).toBeGreaterThanOrEqual(8)
  })

  it('its wrapper is still the flex column the pill relies on', () => {
    const wrap = find('.af-cm-chatwrap').find((r) => r.context.length === 0)!
    expect(decl(wrap, 'display')).toBe('flex')
    expect(decl(wrap, 'flex-direction')).toBe('column')
  })
})

describe('the hover toolbar sits beside the bubble, in a lane the row keeps', () => {
  const HOVER = '@media (hover: hover) and (pointer: fine)'

  it('is hidden on touch, shown only for a fine pointer', () => {
    const base = find('.af-cm-hoverbar').find((r) => r.context.length === 0)!
    expect(decl(base, 'display')).toBe('none')
  })

  it('under a fine pointer it is an in-flow flex item, never floated over the bubble', () => {
    const bar = find('.af-cm-hoverbar').find((r) => r.context.join('|') === HOVER)!
    expect(bar).toBeTruthy()
    expect(decl(bar, 'position')).toBeNull()
    expect(decl(bar, 'top')).toBeNull()
    expect(decl(bar, 'left')).toBeNull()
    expect(decl(bar, 'flex')).toBe('none')
    expect(decl(bar, 'display')).toBe('flex')
    // Hidden by opacity, not display, so its lane is kept and showing it moves nothing.
    expect(decl(bar, 'opacity')).toBe('0')
  })

  it('on your own messages it sits on the left of the bubble, not over it', () => {
    const mine = find(".af-cm-row[data-mine='true'] .af-cm-hoverbar").find((r) => r.context.join('|') === HOVER)!
    expect(decl(mine, 'order')).toBe('-1')
    expect(decl(mine, 'right')).toBeNull()
  })

  it('a narrow drawer keeps only the last button ("More", which holds reactions and Reply)', () => {
    const narrow = find('.af-cm-hoverbar > .af-cm-hoverbtn:not(:last-child)')
    expect(narrow.map((r) => r.context.join('|'))).toContain('@container af-cm (max-width: 559px)')
    expect(decl(narrow[0], 'display')).toBe('none')
  })

  it('the drawer is still the size container that query reads', () => {
    expect(ALL.some((r) => r.selector === '.af-cm' && /container\s*:\s*af-cm\s*\/\s*inline-size/.test(r.body))).toBe(true)
  })
})
