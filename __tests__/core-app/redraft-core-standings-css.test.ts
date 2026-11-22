/**
 * af-core-redraft-standings.css (batch B6): every rule is redraft-only, colours are tokens, @media blocks
 * are top-level, nothing is under the 11px floor, and the four screens actually load it. This is the static
 * half of "other leagues unchanged"; __tests__/core-app/redraft-core-standings-render.test.tsx is the other.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PATH = join(process.cwd(), 'components/core-app/af-core-redraft-standings.css')
const RAW = readFileSync(PATH, 'utf8')
// Prose about a selector is not a selector.
const CSS = RAW.replace(/\/\*[\s\S]*?\*\//g, '')

/** Every selector of every rule, with the @media it sits in (or null). Throws on a nested @media. */
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

const SCOPED = /^\.af-core\.af-shell\[data-format=redraft\] /

describe('af-core-redraft-standings.css', () => {
  const all = selectors(CSS)

  it('finds the rules at all (a parser that reads nothing passes everything)', () => {
    expect(all.length).toBeGreaterThan(50)
    expect(all.some((r) => r.media === '@media (max-width:640px)')).toBe(true)
  })

  it('scopes every rule to the redraft-stamped /core shell', () => {
    expect(all.filter((r) => !SCOPED.test(r.selector)).map((r) => r.selector)).toEqual([])
  })

  it('positive control: an unscoped rule is reported', () => {
    const loose = selectors('.af-st-tile{color:var(--text)} .af-core.af-shell[data-format=redraft] .af-st-tile{color:var(--text)}').filter(
      (r) => !SCOPED.test(r.selector),
    )
    expect(loose.map((r) => r.selector)).toEqual(['.af-st-tile'])
  })

  it('uses tokens only: no hex and no rgb()/hsl() literals', () => {
    expect(CSS.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([])
    expect(CSS.match(/\b(?:rgba?|hsla?)\(/g) ?? []).toEqual([])
  })

  it('keeps every @media block at the top level (the af-matchup.css 560-inside-780 incident)', () => {
    expect(() => selectors(CSS)).not.toThrow()
    expect(() => selectors('@media (max-width:780px){.a{color:red} @media (max-width:560px){.b{color:red}}}')).toThrow(/nested/)
  })

  it('declares no font size under the 11px floor', () => {
    const sizes = [...CSS.matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => Number(m[1]))
    expect(sizes.length).toBeGreaterThan(0)
    expect(sizes.filter((s) => s < 11)).toEqual([])
  })

  it('never targets the history chart: `.af-stb-line` is also an SVG series class', () => {
    const bare = all.filter((r) => /\.af-stb-line\b/.test(r.selector) && !/tr\.af-stb-line/.test(r.selector))
    expect(bare.map((r) => r.selector)).toEqual([])
  })

  it('is imported by all four screens, after their own stylesheets', () => {
    for (const f of ['Standings', 'SeasonOutlookLeague', 'CommissionerHub', 'BracketChallenge']) {
      const src = readFileSync(join(process.cwd(), `components/core-app/screens/${f}.tsx`), 'utf8')
      const at = src.indexOf("import '@/components/core-app/af-core-redraft-standings.css'")
      expect(at, f).toBeGreaterThan(-1)
      const lastOwn = Math.max(...[...src.matchAll(/import '@\/components\/core-app\/af-(?!core-redraft-standings)[a-z-]+\.css'/g)].map((m) => m.index ?? -1))
      expect(at, f).toBeGreaterThan(lastOwn)
    }
  })
})
