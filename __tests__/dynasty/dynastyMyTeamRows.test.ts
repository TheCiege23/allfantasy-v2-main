/**
 * Dynasty My team rows above the phone layout (2026-11-06). Measured at 1440px in /e2e/dynasty-core/myteam: with the
 * right-hand column open the roster list is 542px wide and the shared grid is `46px minmax(0,1fr) 104px auto`. The
 * 104px status track dates from when the chip read "QUESTIONABLE"; it now holds at most three characters in a
 * fixed 34px chip (af-my-team.css "Designations, abbreviated"). So 70px sat idle while the name got 89px: 11 of 15
 * names wrapped, the age chip dropped under every name, and rows averaged 144px.
 *
 * With a 44px status track for dynasty leagues, measured in the same harness: no name wraps and rows average 114px.
 * Phones and tablets keep their own grids (≤860px), and 1200px (no rail) did not change.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { statusShorthand } from '@/lib/core-app/myTeamStatusShorthand'

const CSS = readFileSync(join(process.cwd(), 'components/core-app/af-my-team-dynasty.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const SEL = '.af-core.af-shell[data-dynasty-background=true] .af-mt-row'

/**
 * The shared stylesheet's tablet band: the widest `max-width` block that gives `.af-mt-row` a THREE-track grid. A
 * four-track rule must start above it — the first version started at 721px and, at 820, squeezed the projection
 * pair into a 44px track (measured).
 */
const SHARED = readFileSync(join(process.cwd(), 'components/core-app/af-my-team.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
function tabletMax(): number {
  let max = 0
  for (const m of SHARED.matchAll(/@media\s*\(max-width:\s*(\d+)px\)\s*\{/g)) {
    const open = SHARED.indexOf('{', m.index!)
    let depth = 0
    let end = open
    for (let k = open; k < SHARED.length; k++) {
      if (SHARED[k] === '{') depth++
      else if (SHARED[k] === '}' && --depth === 0) { end = k; break }
    }
    const body = SHARED.slice(open + 1, end)
    const g = body.match(/\.af-mt-row\s*\{[^}]*grid-template-columns\s*:\s*([^;}]+)/)
    if (g && g[1]!.trim().split(/\s+(?![^(]*\))/).length === 3) max = Math.max(max, Number(m[1]))
  }
  return max
}
const DESKTOP_MIN = tabletMax() + 1

/** Body of the top-level `@media (min-width:<DESKTOP_MIN>px)` block. */
function desktopBlock(css: string): string | null {
  const at = css.search(new RegExp(`@media\\s*\\(min-width:\\s*${DESKTOP_MIN}px\\)\\s*\\{`))
  if (at < 0) return null
  const open = css.indexOf('{', at)
  let depth = 0
  for (let k = open; k < css.length; k++) {
    if (css[k] === '{') depth++
    else if (css[k] === '}' && --depth === 0) return css.slice(open + 1, k)
  }
  return null
}

describe('dynasty My team rows above the phone layout', () => {
  const block = desktopBlock(CSS)
  const esc = SEL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const decl = block?.match(new RegExp(`${esc}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
  const tracks = decl.match(/grid-template-columns\s*:\s*([^;]+)/)?.[1]?.trim().split(/\s+(?![^(]*\))/) ?? []

  it('re-sizes the status track for dynasty leagues, desktop band only (above the shared tablet grid)', () => {
    expect(DESKTOP_MIN, 'shared tablet band not found').toBeGreaterThan(721)
    expect(CSS, 'a four-track rule in a band that overlaps the three-track tablet grid').not.toMatch(/@media\s*\(min-width:\s*721px\)/)
    expect(block, `no top-level @media (min-width:${DESKTOP_MIN}px) block`).not.toBeNull()
    expect(tracks, `grid-template-columns for ${SEL}`).toHaveLength(4)
    expect(tracks[1]).toBe('minmax(0,1fr)')
  })

  it('the status track fits the chip and gives the rest to the name', () => {
    const px = Number.parseFloat(tracks[2] ?? 'NaN')
    // The chip is a fixed 34px (min-width) — 13px type in a narrow container still fits 3 characters in ~40px.
    expect(px).toBeGreaterThanOrEqual(40)
    expect(px).toBeLessThanOrEqual(56)
  })

  it('the assumption it rests on: every designation abbreviates to three characters or fewer', () => {
    for (const s of [
      'Questionable', 'Doubtful', 'Out', 'Probable', 'Did not practice', 'DNP', 'Injured Reserve', 'IR', '10-Day IL',
      '60-day IL', 'Suspended', 'PUP', 'Day-to-day', 'Game-time decision', 'Inactive', 'Active', 'Non-Football Injury',
    ]) {
      expect(statusShorthand(s).short.length, s).toBeLessThanOrEqual(3)
    }
  })
})
