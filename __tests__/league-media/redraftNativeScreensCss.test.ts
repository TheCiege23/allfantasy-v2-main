/**
 * redraft-native-screens.css: every rule is redraft-only, colours are tokens, and the @media blocks are
 * top-level. This is the static half of "other formats unchanged"; the render tests in
 * __tests__/league/redraft-native-screens.test.tsx are the other half.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PATH = join(process.cwd(), 'components/league/native/screens/redraft-native-screens.css')
const RAW = readFileSync(PATH, 'utf8')
// Prose about a selector is not a selector (a guard here once matched its own comment).
const CSS = RAW.replace(/\/\*[\s\S]*?\*\//g, '')

/** Every selector of every rule, with the @media it sits in (or null). */
function selectors(css: string): Array<{ selector: string; media: string | null }> {
  const out: Array<{ selector: string; media: string | null }> = []
  let depth = 0
  let media: string | null = null
  let buf = ''
  for (const ch of css) {
    if (ch === '{') {
      const head = buf.trim()
      buf = ''
      if (head.startsWith('@media')) {
        if (depth !== 0) throw new Error(`nested @media: ${head}`)
        media = head
      } else {
        for (const s of head.split(',')) out.push({ selector: s.trim(), media })
      }
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) media = null
      buf = ''
    } else if (depth === 0 || (media && depth === 1)) {
      buf += ch
    } else if (ch === ';') {
      buf = ''
    }
  }
  return out
}

/**
 * A redraft rule either carries the workspace's redraft scope, or targets a `nls-rd-*` class — markup
 * that only the redraft branches of the screens render (RedraftScreenParts.tsx).
 */
const SCOPED = /\.nl-workspace\[data-format=redraft\]/
const RD_ONLY_CLASS = /^\.nls-rd-[a-z-]+/

describe('redraft-native-screens.css', () => {
  const all = selectors(CSS)

  it('finds the rules at all (a parser that reads nothing passes everything)', () => {
    expect(all.length).toBeGreaterThan(120)
    expect(all.some((r) => r.media === '@media (max-width: 767px)')).toBe(true)
  })

  it('scopes every rule to a redraft workspace or to redraft-only markup', () => {
    const loose = all.filter((r) => !SCOPED.test(r.selector) && !RD_ONLY_CLASS.test(r.selector))
    expect(loose).toEqual([])
  })

  it('positive control: an unscoped rule is reported', () => {
    const loose = selectors('.nls-card { color: var(--text); } .nl-workspace[data-format=redraft] .nls-card { color: var(--text); }').filter(
      (r) => !SCOPED.test(r.selector) && !RD_ONLY_CLASS.test(r.selector),
    )
    expect(loose.map((r) => r.selector)).toEqual(['.nls-card'])
  })

  it('uses tokens only: no hex and no rgb()/hsl() colour literals', () => {
    expect(CSS.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([])
    expect(CSS.match(/\b(?:rgba?|hsla?)\(/g) ?? []).toEqual([])
  })

  it('keeps every @media block at the top level (the af-matchup.css 560-inside-780 incident)', () => {
    expect(() => selectors(CSS)).not.toThrow()
    expect(() => selectors('@media (max-width: 780px) { .a { color: red } @media (max-width: 560px) { .b { color: red } } }')).toThrow(/nested/)
  })

  it('declares no font size under the 11px floor', () => {
    const sizes = [...CSS.matchAll(/font(?:-size)?:\s*(?:[^;{}]*?\s)?(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]))
    expect(sizes.length).toBeGreaterThan(20)
    expect(sizes.filter((n) => n < 11)).toEqual([])
  })
})
