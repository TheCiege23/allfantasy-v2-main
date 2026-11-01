/**
 * redraft-deck.css (batch A3) must stay inside the redraft workspace, carry no colour of its own, and
 * never nest an @media block. broadcast-deck.css is shared with /core and every other league, so a
 * selector that escapes the redraft scope would restyle all of them; this sweep is what stops that.
 * Plus: no hex colour literal in the deck's TSX (light mode reads tokens, not a fixed navy).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const SCOPE = '.nl-workspace[data-format=redraft][data-sport]'

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
      if (head.startsWith('@')) {
        stack.push(head)
      } else {
        out.push({ selectors: splitTopLevel(head), at: [...stack] })
        stack.push('rule')
      }
    } else if (ch === '}') {
      stack.pop()
      buf = ''
    } else if (ch === ';' && stack.at(-1) === 'rule') {
      buf = ''
    } else {
      buf += ch
    }
  }
  return out
}

describe('redraft-deck.css', () => {
  const css = read('components/decide/redraft-deck.css')
  const rules = rulesOf(css)

  it('has rules (a parser that found nothing would pass everything below)', () => {
    expect(rules.length).toBeGreaterThan(80)
  })

  it('scopes every selector to the redraft workspace', () => {
    const escaped = rules.flatMap((r) => r.selectors).filter((s) => !s.startsWith(SCOPE))
    expect(escaped).toEqual([])
  })

  it('declares no colour literal — tokens only', () => {
    const body = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(body.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([])
    expect(body.match(/rgba?\(/g) ?? []).toEqual([])
  })

  it('never nests an at-rule inside another', () => {
    expect(rules.filter((r) => r.at.length > 1).map((r) => r.at.join(' > '))).toEqual([])
  })

  it('keeps every font size at or above the 11px floor', () => {
    const sizes = [...css.matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => Number(m[1]))
    expect(sizes.length).toBeGreaterThan(10)
    expect(sizes.filter((n) => n < 11)).toEqual([])
  })
})

describe('the parser is a real check (positive control)', () => {
  it('reports an escaped selector and a nested block', () => {
    const bad = rulesOf(`${SCOPE} :is(.x, .y){color:red} .bdx .b{color:red} @media(max-width:9px){@media(min-width:1px){${SCOPE} .c{x:y}}}`)
    expect(bad.flatMap((r) => r.selectors).filter((s) => !s.startsWith(SCOPE))).toEqual(['.bdx .b'])
    expect(bad.filter((r) => r.at.length > 1)).toHaveLength(1)
  })
})

describe('broadcast-deck.css outside redraft', () => {
  it('keeps the deck navy palette and gives the "me" pick its old colour through a token', () => {
    const css = read('components/decide/broadcast-deck.css')
    expect(css).toMatch(/--bdx-panel: #12163e;/)
    expect(css).toMatch(/--bdx-me: #ff9d5c;/)
  })
})

describe('deck TSX carries no hex colour', () => {
  it.each([
    'components/decide/DecideHome.tsx',
    'components/decide/DraftIntelHome.tsx',
    'components/decide/LegacyHome.tsx',
    'components/decide/RedraftCommishHealth.tsx',
    'components/decide/redraftDeck.tsx',
    'components/league-home/CommissionerOperationsWorkspace.tsx',
  ])('%s', (p) => {
    expect(read(p).match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([])
  })
})
