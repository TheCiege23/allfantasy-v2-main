import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * /core/notifications on a phone (2026-11-25, the simplify pass). CSS only, so this reads the sheet:
 * which rules sit inside the phone query, and what they select.
 */
const css = fs
  .readFileSync(path.join(process.cwd(), 'components/core-app/af-notifications.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')

/** Bodies of every `@media (max-width: 640px) { … }` block, matched by brace depth. */
function phoneBlocks(): string[] {
  const out: string[] = []
  const re = /@media \(max-width: 640px\)\s*\{/g
  let m: RegExpExecArray | null
  while ((m = re.exec(css))) {
    let depth = 1
    let i = m.index + m[0].length
    const start = i
    while (depth > 0 && i < css.length) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') depth--
      i++
    }
    out.push(css.slice(start, i - 1))
  }
  return out
}

describe('/core/notifications on a phone', () => {
  it('the 20px phone size is for the page heading only, never a row title', () => {
    const phone = phoneBlocks().join('\n')
    expect(phone).toMatch(/\.af-nt-head \.af-nt-title\s*\{\s*font-size:\s*20px/)
    // A bare `.af-nt-title` selector in the phone query would size every row headline to 20px again.
    const selectors = [...phone.matchAll(/([^{}]+)\{/g)].flatMap((m) => m[1].split(',').map((x) => x.trim()))
    expect(selectors).toContain('.af-nt-head .af-nt-title')
    expect(selectors).not.toContain('.af-nt-title')
  })

  it('keeps Mark all read beside the heading and the four filters on one row', () => {
    expect(css).toMatch(/\.af-nt-head\s*\{\s*flex-wrap:\s*nowrap/)
    const phone = phoneBlocks().join('\n')
    expect(phone).toMatch(/\.af-nt-filters\s*\{\s*flex-wrap:\s*nowrap/)
    expect(phone).toMatch(/select\.af-nt-filter\s*\{\s*flex:\s*1 1 0;\s*min-width:\s*0/)
  })
})
