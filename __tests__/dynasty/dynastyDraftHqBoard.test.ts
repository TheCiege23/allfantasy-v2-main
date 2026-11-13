/**
 * The dynasty rookie board on a phone (2026-11-06, dynasty audit item 8). At 390px the board shows two rounds side
 * by side and each pick cell is a 34px pick number plus the team name on ONE nowrap line, so "Waiver Wire Wizards"
 * read "Waiver Wire Wiza…" in all four of its cells (measured in /e2e/dynasty-core/draft-hq). One round per row would
 * double the board's length; instead the name may take a second line on a phone. Measured after: no name clipped, the
 * board 32px taller (959 -> 991). 820 and 1440 had no clipped name and are left alone.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CSS = readFileSync(join(process.cwd(), 'components/core-app/af-draft-hq-dynasty.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

function blocks(prelude: RegExp): string[] {
  const out: string[] = []
  for (const m of CSS.matchAll(new RegExp(prelude.source, 'g'))) {
    const open = CSS.indexOf('{', m.index!)
    let depth = 0
    for (let k = open; k < CSS.length; k++) {
      if (CSS[k] === '{') depth++
      else if (CSS[k] === '}' && --depth === 0) { out.push(CSS.slice(open + 1, k)); break }
    }
  }
  return out
}
function decls(body: string, sel: string): Record<string, string> {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const out: Record<string, string> = {}
  for (const m of body.matchAll(new RegExp(`(?:^|[}\\s])${esc}\\s*\\{([^}]*)\\}`, 'g'))) {
    for (const d of m[1]!.split(';')) {
      const at = d.indexOf(':')
      if (at > 0) out[d.slice(0, at).trim()] = d.slice(at + 1).trim()
    }
  }
  return out
}

describe('the dynasty rookie board on a phone', () => {
  const phone = blocks(/@media\s*\(max-width:\s*720px\)\s*\{/).join('\n')
  const team = decls(phone, '.af-dh-dy-cell-team')

  it('a team name may take a second line instead of an ellipsis', () => {
    expect(team['white-space'], 'no phone rule lets the pick cell name wrap').toBe('normal')
    expect(team['-webkit-line-clamp'] ?? team['line-clamp']).toBe('2')
  })

  it('desktop keeps its one-line cells', () => {
    const top = CSS.slice(0, CSS.search(/@media/))
    expect(decls(top, '.af-dh-dy-cell-team')['white-space']).toBe('nowrap')
  })
})
