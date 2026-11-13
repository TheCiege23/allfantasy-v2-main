/**
 * My team's head-to-head row look (af-my-team-h2h.css, 2026-11-09). Sizes only, wide pages only:
 * the row's grid tracks belong to af-my-team.css and af-my-team-dynasty.css, the phone passes stay
 * as they are, and colour stays with the themes.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const H2H = readFileSync(join(process.cwd(), 'components/core-app/af-my-team-h2h.css'), 'utf8')
const SCREEN = readFileSync(join(process.cwd(), 'components/core-app/screens/MyTeam.tsx'), 'utf8')
const code = H2H.replace(/\/\*[\s\S]*?\*\//g, '')

/** The text between an at-rule's opening brace and its matching close, plus what follows it. */
function block(src: string, opener: string) {
  const open = src.indexOf(opener)
  if (open < 0) return null
  let depth = 0
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    if (src[i] === '}' && --depth === 0) return { before: src.slice(0, open), inner: src.slice(src.indexOf('{', open) + 1, i), after: src.slice(i + 1) }
  }
  return null
}

describe("My team's head-to-head row look", () => {
  it('is switched on for every lineup list, and loaded after the base and redraft sheets', () => {
    expect(SCREEN.match(/<ul className="af-mt-list"/g)?.length).toBe(4)
    expect(SCREEN.match(/<ul className="af-mt-list" data-look="h2h">/g)?.length).toBe(4)
    expect(SCREEN.indexOf("af-my-team-h2h.css'")).toBeGreaterThan(SCREEN.indexOf("af-core-redraft-myteam.css'"))
  })

  it('applies only above the phone and tablet passes', () => {
    const media = block(code, '@media (min-width: 861px) {')
    expect(media).not.toBeNull()
    expect(media!.before.trim()).toBe('')
    expect(media!.after.trim()).toBe('')
    const container = block(media!.inner, '@container af-mt (min-width: 601px) {')
    expect(container).not.toBeNull()
    expect(container!.before.trim()).toBe('')
    expect(container!.after.trim()).toBe('')
  })

  it('scopes every rule to the h2h lists', () => {
    const inner = block(block(code, '@media')!.inner, '@container')!.inner
    const selectors = inner.split('}').map((b) => b.split('{')[0].trim()).filter(Boolean)
    expect(selectors.length).toBeGreaterThan(5)
    for (const group of selectors) for (const sel of group.split(',')) expect(sel.trim()).toMatch(/^\.af-mt-list\[data-look='h2h'\] /)
  })

  it('leaves the row grid and colour to the sheets that own them', () => {
    expect(code).not.toMatch(/grid-template-columns/)
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(code).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/)
  })
})
