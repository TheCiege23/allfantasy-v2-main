// @vitest-environment jsdom
/**
 * The root cause of invisible ticks, pinned at the stylesheet.
 *
 * `@tailwindcss/forms` fills a checked box with `currentColor` and paints a WHITE tick. Its rule is
 * `input:where([type='checkbox'])` — specificity 0,0,1 — so the later global
 * `input, textarea, select, button { color: inherit }` (also 0,0,1) used to win, and on dark UI a
 * ticked box became white-on-white. Measured with Playwright on the compiled app CSS, 2026-10-31:
 * before, a checked settings box computed `background-color: rgba(255,255,255,.92)`; after,
 * `rgb(124,58,237)` in both light and dark mode.
 *
 * These read the real `app/globals.css` with postcss and ask jsdom's selector engine which
 * elements each rule actually matches — so a selector that merely LOOKS like it excludes
 * checkboxes cannot pass.
 */
import fs from 'node:fs'
import path from 'node:path'
import postcss, { type Rule } from 'postcss'
import { beforeAll, describe, expect, it } from 'vitest'

const css = fs.readFileSync(path.join(process.cwd(), 'app/globals.css'), 'utf8')
const root = postcss.parse(css)

/** Top-level rules only (not inside @media / @layer), declaring `prop: value`. */
function rulesDeclaring(prop: string, value?: string): Rule[] {
  const out: Rule[] = []
  root.each((node) => {
    if (node.type !== 'rule') return
    node.walkDecls(prop, (d) => {
      if (value === undefined || d.value.trim() === value) out.push(node)
    })
  })
  return out
}

function el(html: string): Element {
  const host = document.createElement('div')
  host.innerHTML = html
  return host.firstElementChild!
}

let checkbox: Element
let radio: Element
let textInput: Element
let button: Element

beforeAll(() => {
  checkbox = el('<input type="checkbox" class="h-4 w-4 rounded border-slate-600 bg-slate-800">')
  radio = el('<input type="radio" class="h-4 w-4">')
  textInput = el('<input type="text" class="w-full">')
  button = el('<button type="button">Go</button>')
})

const matches = (rule: Rule, node: Element) => rule.selectors.some((s) => node.matches(s))

describe('app/globals.css checkbox colour', () => {
  it('no top-level `color: inherit` rule reaches a checkbox or a radio', () => {
    const inherit = rulesDeclaring('color', 'inherit')
    expect(inherit.length).toBeGreaterThan(0)
    for (const rule of inherit) {
      expect(matches(rule, checkbox), rule.selector).toBe(false)
      expect(matches(rule, radio), rule.selector).toBe(false)
    }
  })

  it('…while text inputs, buttons, textareas and selects still inherit', () => {
    const inherit = rulesDeclaring('color', 'inherit')
    for (const node of [textInput, button, el('<textarea></textarea>'), el('<select></select>')]) {
      expect(inherit.some((r) => matches(r, node)), node.outerHTML).toBe(true)
    }
  })

  it('…at 0,0,1 for inputs, so a `text-*` utility on a text input still wins', () => {
    const rule = rulesDeclaring('color', 'inherit').find((r) => matches(r, textInput))!
    const inputSel = rule.selectors.find((s) => s.trim().startsWith('input'))!
    // Everything after `input` is inside a single :where(), which contributes zero specificity.
    expect(inputSel.trim()).toMatch(/^input:where\([^]*\)$/)
  })

  it('checkboxes and radios get the violet fill (the CheckBox primitive colour), at 0,0,1', () => {
    const rules = rulesDeclaring('color', '#7c3aed').filter((r) => matches(r, checkbox))
    expect(rules).toHaveLength(1)
    expect(matches(rules[0], radio)).toBe(true)
    expect(matches(rules[0], textInput)).toBe(false)
    // :where() only — so `text-cyan-500` (0,1,0) on a box still chooses its colour.
    expect(rules[0].selector.trim()).toMatch(/^input:where\([^]*\)$/)
  })

  it('a box naming an accent-* class gets its native rendering back; other classes containing "accent-" do not', () => {
    const rule = rulesDeclaring('appearance', 'auto').find((r) => r.selector.includes("accent-"))!
    expect(rule).toBeTruthy()
    expect(matches(rule, el('<input type="checkbox" class="h-4 w-4 accent-[#ff3d81]">'))).toBe(true)
    expect(matches(rule, el('<input type="checkbox" class="accent-cyan-400">'))).toBe(true)
    expect(matches(rule, el('<input type="checkbox" class="h-4 checked:accent-violet-500">'))).toBe(true)
    expect(matches(rule, el('<input type="radio" class="h-4 w-4 accent-[var(--accent-cyan)]">'))).toBe(true)
    expect(matches(rule, el('<input type="checkbox" class="h-4 w-4 border-[var(--accent-cyan)]">'))).toBe(false)
    expect(matches(rule, checkbox)).toBe(false)
    expect(matches(rule, el('<input type="text" class="accent-cyan-400">'))).toBe(false)
  })
})
