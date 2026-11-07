/**
 * League screens on a phone (2026-11-06 phone pass). Live at 375px the league card was 108px of two
 * rows naming the league a third time, and the decision card on My team repeated its own heading and
 * caveat inside itself. Both fixes are phone-only CSS; this pins that they exist, say what they say,
 * and sit at the top level of their stylesheets (a block nested in another query silently narrows).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Line endings normalised: a Windows checkout writes CRLF and the patterns below are written with \n.
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n')

/** The `@media` block that contains `marker`, braces balanced, and whether it opens at depth 0. */
function mediaBlockAround(css: string, marker: string): { text: string; topLevel: boolean } {
  const at = css.indexOf(marker)
  expect(at, marker).toBeGreaterThan(-1)
  const start = css.lastIndexOf('@media', at)
  const before = css.slice(0, start)
  const topLevel = (before.match(/\{/g) ?? []).length === (before.match(/\}/g) ?? []).length
  let depth = 0
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return { text: css.slice(start, i + 1), topLevel }
  }
  throw new Error('unbalanced')
}

describe('league card is one row on a phone', () => {
  const css = read('components/core-app/af-league-tabs.css')
  const { text, topLevel } = mediaBlockAround(css, '.af-core .af-lctx .af-lctx-name {')

  it('is a top-level phone query', () => {
    expect(topLevel).toBe(true)
    expect(text.startsWith('@media (max-width: 720px)')).toBe(true)
  })

  it('hides the crest and name, which the top switcher already shows, and lays the rest out in a row', () => {
    expect(text).toMatch(/\.af-core \.af-lctx \.af-lctx-crest,\s*\.af-core \.af-lctx \.af-lctx-name \{\s*display: none;/)
    expect(text).toMatch(/\.af-core \.af-lctx \{\s*display: flex;\s*flex-wrap: wrap;/)
  })

  it('gives an opened details panel, the type editor and the recommendation their own full row', () => {
    expect(text).toMatch(/\.af-lctx-details\[open\] \{\s*flex-basis: 100%;/)
    expect(text).toMatch(/\.af-lctx-type,\s*\.af-core \.af-lctx \.af-lctx-action \{\s*flex-basis: 100%;/)
  })
})

describe('the decision card on My team says each thing once on a phone', () => {
  const css = read('components/core-app/af-my-team.css')
  const { text, topLevel } = mediaBlockAround(css, '.af-mt-check--embedded > h2.af-label')

  it('is a top-level phone query that hides only the embedded heading and caveat', () => {
    expect(topLevel).toBe(true)
    expect(text.startsWith('@media (max-width: 720px)')).toBe(true)
    expect(text).toMatch(/\.af-mt-check--embedded > h2\.af-label,\s*\.af-mt-check--embedded > \.af-mt-footnote \{\s*display: none;/)
    // The standalone check keeps both: nothing outside the embedded variant is hidden here.
    expect(text).not.toMatch(/(^|[\s,])\.af-mt-check > /)
  })
})
