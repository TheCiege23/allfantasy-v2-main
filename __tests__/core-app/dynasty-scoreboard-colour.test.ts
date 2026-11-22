import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The Matchup scoreboard follows the league's colour (owner's call, 2026-11-07). Redraft already re-tints
 * it to the sport accent (af-core-redraft-matchup.css); dynasty left it the default cyan inside a gold page.
 *
 * ⚠ THE BOARD IS DARK IN EVERY MODE (af-core.css `--mu-sb-bg`), so its accent must be a light-on-dark
 * gold in every mode — the page's light-mode gold (#7A5310) is cut for WHITE and would sink into it.
 * That is why the token lives in the dynasty DARK block (0,3,0), which no mode palette outranks, and
 * must NOT be redefined in the light block.
 */
const css = readFileSync(path.join(process.cwd(), 'components/core-app/af-core-dynasty.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, (c) => ' '.repeat(c.length))

function block(selector: string): string {
  const at = css.indexOf(`${selector}{`)
  if (at < 0) throw new Error(`no block ${selector}`)
  const before = css.slice(0, at)
  if (before.split('{').length !== before.split('}').length) throw new Error(`${selector} is nested`)
  return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at))
}

const lum = (hex: string) => {
  const c = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

describe('the dynasty Matchup scoreboard', () => {
  const dark = block('.af-core.af-shell[data-dynasty-background=true]')
  const light = block("html[data-mode='light'] .af-core.af-shell[data-dynasty-background=true]")

  it('takes a gold accent, not the default cyan', () => {
    const m = /--mu-sb-accent:\s*#([0-9a-fA-F]{6})/.exec(dark)
    expect(m).not.toBeNull()
    expect(m![1].toLowerCase()).not.toBe('22d3ee')
    // Every board ground from af-core.css (dark, light, AF) and its raised surface.
    for (const ground of ['141a33', '11181c', '1d1336', '1c2342']) expect(ratio(m![1], ground)).toBeGreaterThan(7)
  })

  it('keeps that gold in light mode, where the board stays dark', () => {
    expect(light).not.toMatch(/--mu-sb-accent/)
  })
})
