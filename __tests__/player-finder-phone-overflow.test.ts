import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss, { type AtRule, type Rule } from 'postcss'

/**
 * Player Finder audit, 2026-10-01. Each case was measured on static renders of the real screens at
 * 320/375/390/768/1280px before and after:
 *
 *  - the league strip pushed the player page to 518px on a 375px phone (chip capped at 100% of a
 *    content-sized LI, i.e. of itself);
 *  - the per-league table handed the slot cell its whole max-content and left the league name a
 *    19px column;
 *  - the sticky CTA cut its own label to "Trade for…" while the league name kept its width;
 *  - the trade-value card cut "Amon-Ra St. Brown" on desktop;
 *  - at 320px, the game-day / pitch buttons and the triage lock chip kept a nowrap min-content wider
 *    than their row.
 *
 * These read the EFFECTIVE value — the last same-selector declaration that applies at a given
 * width, in source order — so a later rule silently re-asserting the old value fails here too, and
 * so does a fix that lands inside a media band that no longer covers the width.
 */

const CSS = readFileSync(resolve(__dirname, '../components/core-app/af-player-finder.css'), 'utf8')
const root = postcss.parse(CSS)

/** Does this @media apply at `width`? Only plain max/min-width bands; anything else is skipped. */
function mediaApplies(params: string, width: number): boolean {
  const parts = params.split(/\s+and\s+/i).map((p) => p.trim())
  for (const part of parts) {
    const max = part.match(/^\(max-width:\s*(\d+)px\)$/)
    const min = part.match(/^\(min-width:\s*(\d+)px\)$/)
    if (max) {
      if (width > Number(max[1])) return false
    } else if (min) {
      if (width < Number(min[1])) return false
    } else {
      return false
    }
  }
  return true
}

function effective(selector: string, prop: string, width: number): string | undefined {
  let value: string | undefined
  const visit = (rule: Rule) => {
    const selectors = rule.selector.split(',').map((s) => s.trim().replace(/\s+/g, ' '))
    if (!selectors.includes(selector)) return
    rule.walkDecls(prop, (d) => {
      value = d.value
    })
  }
  for (const node of root.nodes) {
    if (node.type === 'rule') visit(node)
    else if (node.type === 'atrule' && (node as AtRule).name === 'media' && mediaApplies((node as AtRule).params, width)) {
      ;(node as AtRule).each((child) => {
        if (child.type === 'rule') visit(child)
      })
    }
  }
  return value
}

describe('Player Finder — nothing scrolls sideways on a phone', () => {
  it('caps the league strip LI, not just the chip inside it', () => {
    for (const w of [320, 375, 720]) {
      expect(effective('.af-core .af-pf-strip-list > li', 'max-width', w)).toBe('100%')
      expect(effective('.af-core .af-pf-strip-list > li', 'min-width', w)).toBe('0')
    }
  })

  it('lets the game-day, pitch and triage-lock labels wrap at phone width', () => {
    for (const sel of ['.af-core .af-btn.af-pf-gameday-btn', '.af-core .af-btn.af-pf-tw-btn', '.af-core .af-pf-triage-lock .af-pf-lock']) {
      expect(effective(sel, 'white-space', 320), sel).toBe('normal')
      expect(effective(sel, 'max-width', 320), sel).toBe('100%')
    }
  })
})

describe('Player Finder — the league name keeps a column in the phone table', () => {
  it('sizes the slot side with fit-content, never a bare auto', () => {
    const cols = effective('.af-core .af-pf-table tr', 'grid-template-columns', 375)
    expect(cols).toMatch(/^minmax\(0, 1fr\) fit-content\(\d+%\)$/)
  })
})

describe('Player Finder — the sticky CTA reads in full', () => {
  it('does not shrink, and wraps rather than cutting its label', () => {
    expect(effective('.af-core .af-pf-stickybar-btn', 'flex-shrink', 375)).toBe('0')
    expect(effective('.af-core .af-pf-stickybar-btn', 'white-space', 375)).toBe('normal')
    expect(effective('.af-core .af-pf-stickybar-btn', 'max-width', 375)).toBe('66%')
  })
})

describe('Player Finder — trade-value names', () => {
  it('wrap to two lines at every width instead of a one-line ellipsis', () => {
    for (const w of [375, 768, 1280]) {
      expect(effective('.af-core .af-pf-tv-asset-name', 'white-space', w)).toBe('normal')
      expect(effective('.af-core .af-pf-tv-asset-name', '-webkit-line-clamp', w)).toBe('2')
    }
  })
})
