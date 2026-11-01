/**
 * af-core-redraft-waivers-finder.css (batch B5: Waivers, Player Finder, Draft HQ on /core) must stay inside
 * the /core shell's redraft stamp, carry no colour of its own, keep the 11px floor and never nest an
 * at-rule. The three screens it styles render for EVERY /core league — dynasty, keeper, best ball, every
 * import — so a selector that escapes the stamp would restyle all of them; this sweep is what stops that.
 *
 * ⚠ THE CHECKER IS ONE FUNCTION, AND THE MUTATION CONTROLS RUN IT ON MUTATED COPIES OF THE REAL FILE.
 * A control on a hand-written toy string proves the parser handles the toy; mutating the shipped bytes
 * proves the same check that passes the file would fail it.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const FILE = 'components/core-app/af-core-redraft-waivers-finder.css'
const SCOPE = '.af-core.af-shell[data-format=redraft]'

/** Split a selector list on commas that are not inside `:is(…)` / `:not(…)` parentheses. */
function splitTopLevel(list: string): string[] {
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of list) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      parts.push(cur)
      cur = ''
    } else cur += ch
  }
  parts.push(cur)
  return parts.map((s) => s.trim()).filter(Boolean)
}

/** Every rule's selector list, with the at-rule chain it sits in. Comments stripped first. */
function rulesOf(css: string): Array<{ selectors: string[]; at: string[] }> {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: Array<{ selectors: string[]; at: string[] }> = []
  const stack: string[] = []
  let buf = ''
  for (const ch of src) {
    if (ch === '{') {
      const head = buf.trim()
      buf = ''
      if (head.startsWith('@')) stack.push(head)
      else {
        out.push({ selectors: splitTopLevel(head), at: [...stack] })
        stack.push('rule')
      }
    } else if (ch === '}') {
      stack.pop()
      buf = ''
    } else if (ch === ';' && stack.at(-1) === 'rule') buf = ''
    else buf += ch
  }
  return out
}

/** Every violation in a stylesheet, as readable strings. Empty means it passes. */
function violations(css: string): string[] {
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules = rulesOf(css)
  const out: string[] = []
  if (rules.length < 30) out.push(`only ${rules.length} rules parsed`)
  for (const s of rules.flatMap((r) => r.selectors)) if (!s.startsWith(SCOPE)) out.push(`unscoped: ${s}`)
  for (const r of rules) if (r.at.length > 1) out.push(`nested at-rule: ${r.at.join(' > ')}`)
  if ((body.match(/@media/g) ?? []).length > 1) out.push('more than one @media block')
  for (const m of body.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []) out.push(`hex: ${m}`)
  for (const m of body.match(/\b(?:rgba?|hsla?)\(/g) ?? []) out.push(`colour function: ${m}`)
  for (const m of body.matchAll(/font-size:\s*([\d.]+)(px|rem|em)/g)) {
    const px = m[2] === 'px' ? Number(m[1]) : Number(m[1]) * 16
    if (px < 11) out.push(`font-size under 11px: ${m[0]}`)
  }
  if (/!important/.test(body)) out.push('!important')
  return out
}

describe('af-core-redraft-waivers-finder.css', () => {
  const css = read(FILE)

  it('passes every rule: scoped to the stamp, tokens only, 11px floor, one top-level @media', () => {
    expect(violations(css)).toEqual([])
  })

  it('actually sets font sizes and reads tokens (a file with neither would pass the sweep vacuously)', () => {
    expect([...css.matchAll(/font-size:\s*[\d.]+px/g)].length).toBeGreaterThanOrEqual(2)
    expect(css).toMatch(/var\(--rd-accent\)/)
    expect(css).toMatch(/var\(--rd-accent-text\)/)
  })

  it('carries the --rd-b5 marker the capture script reads on every screen root', () => {
    expect(css).toMatch(/:is\(\.af-wv,\.af-pf,\.af-dh\)\{--rd-b5:on\}/)
  })

  it('restates the accent on Player Finder’s own nested `.af-core` root', () => {
    expect(css).toMatch(/\.af-pf\.af-core\{--accent:var\(--rd-accent-text\)/)
  })

  it.each([
    'components/core-app/screens/Waivers.tsx',
    'components/core-app/screens/PlayerFinder.tsx',
    'components/core-app/screens/DraftHq.tsx',
  ])('is imported by %s', (p) => {
    expect(read(p)).toContain("import '@/components/core-app/af-core-redraft-waivers-finder.css'")
  })

  it('leaves broadcast-deck.css (shared with every league) alone', () => {
    expect(read('components/decide/broadcast-deck.css')).toMatch(/--bdx-grad: linear-gradient\(90deg, #ff3d81, #ff8a3d\);/)
  })
})

describe('mutation controls: the same checker fails the real file once it is broken', () => {
  const css = read(FILE)
  const firstScoped = `${SCOPE} .af-wv-tile{`

  it('the mutation targets exist in the shipped file (or every control below is a no-op)', () => {
    expect(css).toContain(firstScoped)
    expect(css).toContain('var(--rd-accent-text)')
    expect(css).toContain('font-size:16px')
  })

  it('an unscoped rule is reported', () => {
    const mutated = css.replace(firstScoped, '.af-wv-tile{')
    expect(mutated).not.toBe(css)
    expect(violations(mutated)).toContain('unscoped: .af-wv-tile')
  })

  it('a hex colour and an rgba() are reported', () => {
    const mutated = css.replace('var(--rd-accent-text)', '#22d3ee').replace('var(--rd-track)', 'rgba(0,0,0,.2)')
    expect(violations(mutated)).toEqual(expect.arrayContaining(['hex: #22d3ee', 'colour function: rgba(']))
  })

  it('a 10px font is reported', () => {
    const mutated = css.replace('font-size:16px', 'font-size:10px')
    expect(violations(mutated)).toContain('font-size under 11px: font-size:10px')
  })

  it('an @media nested in another is reported', () => {
    const mutated = css.replace('@media (max-width:720px){', '@media (max-width:720px){@media (min-width:1px){.x{}}')
    expect(violations(mutated).some((v) => v.startsWith('nested at-rule'))).toBe(true)
  })
})
