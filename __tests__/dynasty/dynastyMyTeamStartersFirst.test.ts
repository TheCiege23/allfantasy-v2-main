/**
 * Dynasty My team, stacked layout: the starters come right after the header and the lock banner (2026-11-06, dynasty
 * audit item 2 — the user chose "starters first"). Measured at 390px in /e2e/dynasty-core/myteam: the projection header
 * (279px), the lock banner (140), the Sleeper check (158), the lineup decision (742) and the projected matchup (239)
 * all came first, and the first player sat at y≈1945. The shared stylesheet records that order as deliberate for
 * every format; for dynasty leagues the roster now leads, and the decision, the check and the matchup follow it.
 *
 * The page stacks by measuring ITSELF (`container: af-mt`, side-by-side from 900px), so the rule lives in the same
 * container band. And it orders all three explicitly: the shared header (-2) and lock (-1) orders only apply at
 * <=500px, so a bare `order:-1` on the starters would jump them ABOVE the header between 501 and 899px.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '')
const DYN = strip(readFileSync(join(process.cwd(), 'components/core-app/af-my-team-dynasty.css'), 'utf8'))
const SHARED = strip(readFileSync(join(process.cwd(), 'components/core-app/af-my-team.css'), 'utf8'))

function block(css: string, prelude: RegExp): string | null {
  const at = css.search(prelude)
  if (at < 0) return null
  const open = css.indexOf('{', at)
  let depth = 0
  for (let k = open; k < css.length; k++) {
    if (css[k] === '{') depth++
    else if (css[k] === '}' && --depth === 0) return css.slice(open + 1, k)
  }
  return null
}
function order(body: string, sel: string): number {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = body.match(new RegExp(`(?:^|[}\\s])${esc}\\s*\\{[^}]*order\\s*:\\s*(-?\\d+)`))
  return m ? Number(m[1]) : NaN
}

const WIDE = Number(SHARED.match(/@container\s+af-mt\s*\(\s*min-width:\s*(\d+)px\s*\)/)?.[1])
const D = '.af-core.af-shell[data-dynasty-background=true] .af-mt'

describe('dynasty My team, stacked: starters first', () => {
  const narrow = block(DYN, new RegExp(`@container\\s+af-mt\\s*\\(\\s*max-width:\\s*${WIDE - 1}px\\s*\\)\\s*\\{`))

  it('lives in the stacked band, which ends where the shared side-by-side layout starts', () => {
    expect(WIDE, 'shared wide container band not found').toBeGreaterThan(0)
    expect(narrow, `no @container af-mt (max-width:${WIDE - 1}px) block in af-my-team-dynasty.css`).not.toBeNull()
  })

  it('orders header, then lock, then starters — all before the order-0 tools', () => {
    const head = order(narrow ?? '', `${D} > .af-mt-head`)
    const lock = order(narrow ?? '', `${D} > .af-mt-lock`)
    const starters = order(narrow ?? '', `${D} #af-mt-starters`)
    expect([head, lock, starters].every(Number.isFinite), `head ${head}, lock ${lock}, starters ${starters}`).toBe(true)
    expect(head).toBeLessThan(lock)
    expect(lock).toBeLessThan(starters)
    expect(starters).toBeLessThan(0)
  })

  it('the shared header/lock orders it overrides really are phone-only (why all three are set)', () => {
    // If this ever moves out of the <=500px band, the explicit header/lock orders above may become redundant.
    expect(SHARED).toMatch(/@container\s+af-mt\s*\(\s*max-width:\s*500px\s*\)\s*\{[^@]*\.af-mt\s*>\s*\.af-mt-head\s*\{\s*order:\s*-2/)
  })
})
